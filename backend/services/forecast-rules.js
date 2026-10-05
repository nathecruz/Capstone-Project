// The activity-based forecast: the same formula the ML service answers with while no trained
// model is approved (ml-service/app/services/predictor.py, _fallback_prediction). The backend
// uses it when the ML service is asleep or unreachable, so a forecast is always available.

/** How long to wait for the ML service before answering with the rules (it answers in well under a second when awake). */
export const ML_FORECAST_WAIT_MS = 5000;
/** After the ML service did not answer, the rules answer straight away for this long; the missed request is already waking it. */
export const ML_RETRY_AFTER_MS = 60 * 1000;
const serviceState = { downUntil: 0 };

const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const round4 = (value) => Math.round(value * 10000) / 10000;
const titleCase = (text) => String(text).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_match, before, letter) => before + letter.toUpperCase());

/** A forecast shaped like the ML service's answer, computed from the habit's check-in signal. */
export function rulesForecast(signal, reason = 'the ML service is waking up') {
  const days = Array.isArray(signal.last_7_days) ? signal.last_7_days : [];
  const recentRate = days.reduce((total, day) => total + Number(day || 0), 0) / Math.max(days.length, 1);
  const completionProbability = clamp(
    Number(signal.completion_rate || 0) * 0.5
    + recentRate * 0.3
    + Math.min(Number(signal.streak || 0) / 30, 1) * 0.2,
  );
  const recommendation = completionProbability >= 0.5
    ? 'Keep the routine small and repeatable to build momentum.'
    : 'Use a smaller step and a stronger cue to restart momentum.';
  return {
    habit_name: signal.habit_name,
    completion_probability: round4(completionProbability),
    dropout_risk: round4(clamp(1 - completionProbability)),
    confidence: 0,
    recommended_action: recommendation,
    suggested_reminder_time: completionProbability >= 0.5 ? '19:00' : '07:30',
    summary: `${titleCase(signal.habit_name)} has a deterministic fallback forecast because ${reason}. ${recommendation}`,
    models_used: ['Deterministic fallback'],
    prediction_source: 'fallback',
    is_fallback: true,
  };
}

/**
 * Asks the ML service for a forecast, waiting at most ML_FORECAST_WAIT_MS. The request also wakes a
 * sleeping service, so later forecasts come from it again. Without an answer, the rules answer,
 * and keep answering without waiting for ML_RETRY_AFTER_MS.
 * source: 'ml' (the service answered) or 'rules' (computed here).
 */
export async function forecastFor(signal, { url, key, timeoutMs, fetchImpl = fetch, state = serviceState, now = Date.now }) {
  if (key && now() >= state.downUntil) {
    try {
      const result = await fetchImpl(`${url.replace(/\/$/, '')}/api/predict/habit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ML-Service-Key': key },
        body: JSON.stringify(signal),
        signal: AbortSignal.timeout(Math.min(timeoutMs, ML_FORECAST_WAIT_MS)),
      });
      if (result.ok) {
        const prediction = await result.json();
        if (typeof prediction?.completion_probability === 'number') return { prediction, source: 'ml' };
      }
    } catch {
      // Asleep, starting or unreachable (a service that answers, even with an error, is awake).
      state.downUntil = now() + ML_RETRY_AFTER_MS;
    }
  }
  return { prediction: rulesForecast(signal, key ? 'the ML service is waking up' : 'the ML service is not configured'), source: 'rules' };
}
