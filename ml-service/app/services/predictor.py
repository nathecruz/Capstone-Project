from __future__ import annotations

import hashlib
import json
import math
import os
from typing import Any

import joblib

from app.schemas import HabitSignal
from app.services.advanced_models import predict_advanced
from app.services.model_training import (
    FEATURE_NAMES,
    MINIMUM_EVALUATION_ROWS,
    MINIMUM_F1,
    MINIMUM_ROC_AUC,
    MODEL_EVALUATION_PATH,
    MODEL_PATH,
    train_models,
)


def _safe_float(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _priority_score(priority: str) -> float:
    return {'high': 1.0, 'balanced': 0.5, 'low': 0.0}.get(priority.lower(), 0.5)


def _goal_type_score(goal_type: str) -> float:
    return {
        'health': 1.0,
        'fitness': 1.0,
        'learning': 0.75,
        'productivity': 0.75,
        'mindfulness': 0.5,
    }.get(goal_type.lower(), 0.5)


def _features(signal: HabitSignal) -> list[list[float]]:
    recent_completion_rate = sum(signal.last_7_days) / max(len(signal.last_7_days), 1)
    return [[
        float(signal.streak),
        signal.completion_rate,
        float(signal.missed_days),
        recent_completion_rate,
        float(signal.average_session_minutes),
        _priority_score(signal.priority),
        _goal_type_score(signal.goal_type),
    ]]


def _training_average_session_minutes(artifact: dict[str, Any]) -> float:
    feature_means = artifact.get('feature_means', {})
    value = feature_means.get('average_session_minutes') if isinstance(feature_means, dict) else None
    if value is None:
        pipeline = artifact.get('logistic_regression')
        steps = getattr(pipeline, 'named_steps', {})
        scaler = steps.get('standardscaler') if hasattr(steps, 'get') else None
        means = getattr(scaler, 'mean_', None)
        feature_index = FEATURE_NAMES.index('average_session_minutes')
        if means is not None and len(means) > feature_index:
            value = means[feature_index]
    if value is None or not math.isfinite(float(value)) or float(value) < 0:
        raise ValueError('The model artifact does not provide a valid training baseline for unmeasured session duration.')
    return float(value)


def _load_models() -> dict[str, Any]:
    if not MODEL_PATH.exists():
        train_models()
    return joblib.load(MODEL_PATH)


def get_model_readiness() -> dict[str, Any]:
    if os.getenv('NODE_ENV', '').lower() == 'production' and os.getenv('ML_MODEL_RELEASE_APPROVED', '').strip().lower() != 'true':
        return {'ready': False, 'reason': 'production model release approval missing'}

    if not MODEL_PATH.is_file():
        return {'ready': False, 'reason': 'model artifact missing'}

    try:
        artifact = joblib.load(MODEL_PATH)
        if artifact.get('training_source') != 'approved anonymized labeled outcomes':
            return {'ready': False, 'reason': 'training data approval missing'}
        if artifact.get('feature_names') != FEATURE_NAMES:
            return {'ready': False, 'reason': 'model feature schema mismatch'}

        training_dataset_hash = artifact.get('training_dataset_sha256')
        if not isinstance(training_dataset_hash, str) or len(training_dataset_hash) != 64:
            return {'ready': False, 'reason': 'training dataset provenance missing'}

        if not MODEL_EVALUATION_PATH.is_file():
            return {'ready': False, 'reason': 'holdout evaluation missing'}
        report = json.loads(MODEL_EVALUATION_PATH.read_text(encoding='utf-8'))
        if report.get('synthetic_demo') is True:
            return {'ready': False, 'reason': 'synthetic demo evaluation is not production evidence'}
        if report.get('training_source') != artifact.get('training_source'):
            return {'ready': False, 'reason': 'evaluation training provenance mismatch'}
        evaluation_hash = report.get('evaluation_dataset_sha256')
        if report.get('approved') is not True:
            return {'ready': False, 'reason': 'holdout evaluation not approved'}
        if report.get('training_dataset_sha256') != training_dataset_hash:
            return {'ready': False, 'reason': 'evaluation does not match trained artifact'}
        if not isinstance(evaluation_hash, str) or len(evaluation_hash) != 64 or evaluation_hash == training_dataset_hash:
            return {'ready': False, 'reason': 'independent holdout dataset required'}
        artifact_hash = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()
        if report.get('artifact_sha256') != artifact_hash:
            return {'ready': False, 'reason': 'model changed after evaluation'}
        if report.get('dataset_rows', 0) < 2 or not {'logistic_regression', 'random_forest'}.issubset(report.get('models', {})):
            return {'ready': False, 'reason': 'holdout evaluation incomplete'}
        if report['dataset_rows'] < MINIMUM_EVALUATION_ROWS:
            return {'ready': False, 'reason': 'holdout evaluation dataset too small'}
        for metrics in report['models'].values():
            if metrics.get('f1', 0.0) < MINIMUM_F1:
                return {'ready': False, 'reason': 'holdout F1 below production threshold'}
            if metrics.get('roc_auc', 0.0) < MINIMUM_ROC_AUC:
                return {'ready': False, 'reason': 'holdout ROC-AUC below production threshold'}
    except (OSError, ValueError, TypeError, AttributeError, KeyError):
        return {'ready': False, 'reason': 'model approval metadata invalid'}

    return {'ready': True, 'reason': 'approved model and holdout evaluation available'}


def _fallback_prediction(signal: HabitSignal, reason: str = 'trained model artifacts could not be loaded') -> dict[str, Any]:
    recent_completion_rate = sum(signal.last_7_days) / max(len(signal.last_7_days), 1)
    completion_probability = _safe_float(
        signal.completion_rate * 0.5
        + recent_completion_rate * 0.3
        + min(signal.streak / 30.0, 1.0) * 0.2
    )
    dropout_risk = _safe_float(1.0 - completion_probability)
    recommendation = (
        'Keep the routine small and repeatable to build momentum.'
        if completion_probability >= 0.5
        else 'Use a smaller step and a stronger cue to restart momentum.'
    )
    return {
        'habit_name': signal.habit_name,
        'completion_probability': round(completion_probability, 4),
        'dropout_risk': round(dropout_risk, 4),
        'confidence': 0.0,
        'recommended_action': recommendation,
        'suggested_reminder_time': '19:00' if completion_probability >= 0.5 else '07:30',
        'summary': f'{signal.habit_name.title()} has a deterministic fallback forecast because {reason}. {recommendation}',
        'models_used': ['Deterministic fallback'],
        'prediction_source': 'fallback',
        'is_fallback': True,
    }


def predict_habit(signal: HabitSignal) -> dict[str, Any]:
    # Production never serves a model without an approved, independently evaluated release;
    # until one exists it answers with the labelled activity-based fallback instead of an error.
    if os.getenv('NODE_ENV', '').lower() == 'production' and not get_model_readiness()['ready']:
        return _fallback_prediction(signal, 'no approved trained model is deployed yet')

    try:
        artifact = _load_models()
    except (OSError, ValueError, KeyError, RuntimeError, TypeError) as error:
        print(f'ML model artifacts unavailable; using deterministic fallback: {error}')
        return _fallback_prediction(signal)

    effective_signal = signal
    if signal.average_session_minutes is None:
        try:
            effective_signal = signal.model_copy(update={
                'average_session_minutes': _training_average_session_minutes(artifact),
            })
        except (AttributeError, KeyError, TypeError, ValueError, RuntimeError) as error:
            print(f'ML session-duration baseline unavailable; using deterministic fallback: {error}')
            return _fallback_prediction(signal)

    values = _features(effective_signal)
    logistic_probability = float(artifact['logistic_regression'].predict_proba(values)[0][1])
    forest_probability = float(artifact['random_forest'].predict_proba(values)[0][1])
    if os.getenv('NODE_ENV', '').lower() == 'production':
        advanced = {'models_used': []}
    else:
        try:
            advanced = predict_advanced(effective_signal)
        except (OSError, ValueError, KeyError, RuntimeError, TypeError) as error:
            print(f'Optional advanced model artifacts unavailable; continuing with core models: {error}')
            advanced = {'models_used': []}
    probabilities = [logistic_probability, forest_probability]
    for model_key in ('xgboost_probability', 'arima_forecast', 'lstm_probability'):
        if model_key in advanced:
            probabilities.append(float(advanced[model_key]))
    completion_probability = _safe_float(sum(probabilities) / len(probabilities))
    agreement = 1.0 - min(1.0, abs(logistic_probability - forest_probability))
    confidence = _safe_float(0.65 + agreement * 0.25 + min(signal.streak / 100.0, 0.1))
    recent_completion_rate = sum(signal.last_7_days) / max(len(signal.last_7_days), 1)
    dropout_risk = _safe_float((1.0 - completion_probability) * 0.65 + (1.0 - recent_completion_rate) * 0.35)

    if completion_probability >= 0.75:
        recommendation = 'Keep the streak stable and maintain the current routine.'
        reminder = '08:00'
    elif completion_probability >= 0.55:
        recommendation = 'Reduce friction by making the habit shorter and more consistent.'
        reminder = '19:00'
    else:
        recommendation = 'The habit is at risk. Use a smaller step and a stronger cue to restart momentum.'
        reminder = '07:30'

    summary = (
        f'{signal.habit_name.title()} has a {completion_probability:.0%} predicted completion probability '
        f'and {dropout_risk:.0%} dropout risk based on {", ".join(["Logistic Regression", "Random Forest", *advanced["models_used"]])}. '
        f'{recommendation}'
    )

    return {
        'habit_name': signal.habit_name,
        'completion_probability': round(completion_probability, 4),
        'dropout_risk': round(dropout_risk, 4),
        'confidence': round(confidence, 4),
        'recommended_action': recommendation,
        'suggested_reminder_time': reminder,
        'summary': summary,
        'models_used': ['Logistic Regression', 'Random Forest', *advanced['models_used']],
        'prediction_source': 'model',
        'is_fallback': False,
        'cluster_id': advanced.get('cluster_id'),
        'arima_forecast': advanced.get('arima_forecast'),
        'lstm_probability': advanced.get('lstm_probability'),
        'xgboost_probability': advanced.get('xgboost_probability'),
    }
