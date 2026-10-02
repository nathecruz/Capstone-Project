## Model evaluation

Evaluate the trained classifiers against anonymized real outcomes. The dataset must not contain names, emails, habit labels, account IDs, or other direct identifiers.

Required CSV columns:

```text
streak,completion_rate,missed_days,last_7_days,average_session_minutes,priority,goal_type,completed_next_7_days
```

`last_7_days` must contain seven comma-separated `0`/`1` values. `completed_next_7_days` is the actual outcome label: `1` if the habit was completed at least once in the following seven days, otherwise `0`.

To build these files from real HabitAI check-ins, run the backend exporter (reads Neon,
writes to the git-ignored `ml-service/data/private/`, and splits users between the
training and holdout files so the holdout stays independent):

```powershell
npm --prefix backend run ml:export
```

It only uses active student accounts, keeps model features and the observed outcome
(no names, emails, habit labels or ids), and refuses to export until at least 10 users
have a week of history. `average_session_minutes` is exported as a constant because the
app does not measure it; predictions omit it and fall back to the training mean.
Until a model trained this way passes the thresholds below, the app labels every
forecast as an experimental estimate.

Run the evaluation from `ml-service` after installing the requirements:

```powershell
python scripts/evaluate_models.py --dataset path/to/independent-holdout-outcomes.csv --approved-anonymized --output models/evaluation-report.json
```

The report contains accuracy, precision, recall, F1, ROC-AUC, dataset hashes, and
the artifact hash. Production approval requires a holdout dataset with at least
100 rows, F1 of at least 0.65 and ROC-AUC of at least 0.70 for both classifiers,
and the explicit `--approved-anonymized` flag. The holdout file must be
independent from the training file.
# Habit AI Prediction Service

This service is the recommended ML layer for the habit tracker system.

## Recommended architecture

- Expo app -> user interface
- Express backend -> app logic, habits, profiles, leaderboard
- FastAPI ML service -> predictions, risk scoring, AI recommendations
- PostgreSQL/Supabase -> persistent data store

## Models

The forecast uses an ensemble of two scikit-learn classifiers:

- Logistic Regression for a calibrated completion probability
- Random Forest for nonlinear habit patterns

The advanced model layer also supports:

- XGBoost for boosted tabular prediction
- K-Means for behavioral habit clustering
- ARIMA for short recent-history forecasting
- TensorFlow LSTM for sequence-based next-day probability

The API returns `models_used` so the app can distinguish models that actually
ran from optional models whose dependencies or artifacts are not available.
Inference requests may omit `average_session_minutes`. When omitted, the service
uses the mean stored with the trained artifact (or the fitted scaler mean for
older artifacts). The HabitAI client omits this value because it does not
measure per-user session duration. Training and holdout CSVs still require the
column so its feature distribution is based on measured outcomes.

The bundled model artifact is trained from bootstrap scenarios. It may run in
development, but production health and prediction endpoints remain unavailable
until the model is trained on approved, anonymized outcomes and the independent
holdout report meets the release thresholds above. Set
`ML_TRAINING_DATASET_APPROVED=true` only after verifying data approval and
anonymization. Production also requires `ML_MODEL_RELEASE_APPROVED=true` in the
service environment as an explicit release gate; leave it false until the model
and independent evaluation have been verified. The synthetic demo dataset
generator deliberately writes a `synthetic_demo` column so its output is
rejected by the training and evaluation commands. Production inference uses the
evaluated core classifiers; optional advanced artifacts trained from synthetic
sequences are development-only.

Train a production artifact with an approved dataset:

```powershell
$env:NODE_ENV = "production"
$env:ML_TRAINING_DATASET = "path/to/approved-anonymized-training.csv"
$env:ML_TRAINING_DATASET_APPROVED = "true"
python -m app.services.model_training
```

Build the ML container only after the trained artifact and its matching
`models/evaluation-report.json` are in the image build context. The ML `/health`
endpoint returns HTTP 503 in production until the artifact, independent report,
approval, provenance hashes, and quality thresholds all match. Until then
`/api/predict/habit` never uses the unapproved model: it answers with the deterministic,
activity-based fallback (`prediction_source: "fallback"`, `is_fallback: true`), which the
app labels as such.

## Endpoint

- GET /health
- POST /api/predict/habit (requires the `X-ML-Service-Key` header)

## Example request

```json
{
  "habit_name": "Workout",
  "streak": 12,
  "completion_rate": 0.8,
  "missed_days": 2,
  "last_7_days": [1, 1, 0, 1, 1, 1, 0],
  "average_session_minutes": 30,
  "priority": "high",
  "goal_type": "health"
}
```

## Run locally

Use Python 3.11 or 3.12.

```bash
cd ml-service
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
$env:ML_SERVICE_API_KEY = "replace-with-a-long-random-secret"
python -m app.services.model_training
python -m app.services.advanced_models
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The training command writes `models/habit_models.joblib`. Run it again after
adding labeled training data to retrain both models.

## Why this is the best fit

This keeps the app backend simple while adding a proper machine-learning service for habit completion forecasting and smart suggestions.
