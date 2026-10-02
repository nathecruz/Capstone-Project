import os
import hmac

from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from app.schemas import HabitPredictionResponse, HabitSignal
from app.services.predictor import get_model_readiness, predict_habit

app = FastAPI(title="Habit AI Prediction Service", version="1.0.0")
ml_service_api_key = os.getenv("ML_SERVICE_API_KEY", "").strip()
is_production = os.getenv('NODE_ENV', '').lower() == 'production'
if (
    not ml_service_api_key
    or ml_service_api_key.startswith("replace-with-")
    or set(ml_service_api_key.lower()) == {"x"}
    or (is_production and (len(ml_service_api_key) < 32 or ml_service_api_key.startswith('dev-only-')))
):
    raise RuntimeError("ML_SERVICE_API_KEY must be configured.")

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:19006,http://localhost:19080,http://localhost:8081",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.get('/healthz')
def liveness():
    return {'ok': True}


@app.get('/health')
def health(response: Response):
    readiness = get_model_readiness()
    if is_production and not readiness['ready']:
        response.status_code = 503
    return {
        'ok': readiness['ready'] if is_production else True,
        'service': 'habit-ai-prediction',
        'modelReady': readiness['ready'],
        'modelReason': None if readiness['ready'] else readiness['reason'],
    }


@app.post('/api/predict/habit', response_model=HabitPredictionResponse)
def predict_habit_endpoint(signal: HabitSignal, x_ml_service_key: str | None = Header(default=None)):
    if not x_ml_service_key or not hmac.compare_digest(x_ml_service_key, ml_service_api_key):
        raise HTTPException(status_code=401, detail='ML service authentication required.')

    try:
        result = predict_habit(signal)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return HabitPredictionResponse(**result)


@app.get('/')
def root():
    return {'message': 'Habit AI service is running.'}
