type PredictionResult = { is_fallback?: boolean } | null;

export function getPredictionPresentation(prediction: PredictionResult, loading: boolean) {
  if (prediction?.is_fallback) {
    return {
      label: 'Deterministic fallback',
      detail: 'The trained model was unavailable. This is a deterministic activity-based fallback, not a trained-model forecast.',
      icon: 'calculator-outline',
      hasForecast: true,
    };
  }

  if (prediction) {
    return {
      label: 'ML model forecast',
      detail: 'This estimate comes from the ML service model. It is experimental and is not production-validated.',
      icon: 'sparkles',
      hasForecast: true,
    };
  }

  if (loading) {
    return {
      label: 'Loading forecast',
      detail: 'Checking whether a model forecast is available.',
      icon: 'hourglass-outline',
      hasForecast: false,
    };
  }

  return {
    label: 'Recorded progress',
    detail: 'No model forecast is available. These figures summarize recorded activity only.',
    icon: 'analytics-outline',
    hasForecast: false,
  };
}