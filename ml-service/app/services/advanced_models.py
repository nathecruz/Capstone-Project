from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib
import numpy as np

from app.schemas import HabitSignal
from app.services.model_training import FEATURE_NAMES, _load_outcome_dataset

ADVANCED_MODEL_PATH = Path(__file__).resolve().parents[2] / 'models' / 'advanced_models.joblib'
LSTM_MODEL_PATH = Path(__file__).resolve().parents[2] / 'models' / 'habit_lstm.keras'


def train_advanced_models() -> dict[str, Any]:
    features, labels, _ = _load_outcome_dataset()
    artifact: dict[str, Any] = {'feature_names': FEATURE_NAMES, 'models_used': []}

    try:
        from xgboost import XGBClassifier
        xgboost = XGBClassifier(
            n_estimators=120,
            max_depth=4,
            learning_rate=0.06,
            subsample=0.9,
            colsample_bytree=0.9,
            eval_metric='logloss',
            random_state=42,
        )
        xgboost.fit(features, labels)
        artifact['xgboost'] = xgboost
        artifact['models_used'].append('XGBoost')
    except ImportError:
        pass

    try:
        from sklearn.cluster import KMeans
        clusters = KMeans(n_clusters=3, n_init=10, random_state=42)
        clusters.fit(features)
        artifact['kmeans'] = clusters
        artifact['models_used'].append('K-Means')
    except ImportError:
        pass

    ADVANCED_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, ADVANCED_MODEL_PATH)

    try:
        import tensorflow as tf
        sequences, sequence_labels = _lstm_dataset()
        lstm = tf.keras.Sequential([
            tf.keras.layers.Input(shape=(7, 1)),
            tf.keras.layers.LSTM(12),
            tf.keras.layers.Dense(1, activation='sigmoid'),
        ])
        lstm.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])
        lstm.fit(np.array(sequences), np.array(sequence_labels), epochs=12, batch_size=16, verbose=0)
        lstm.save(LSTM_MODEL_PATH, include_optimizer=False)
        artifact['models_used'].append('LSTM')
    except ImportError:
        pass

    return artifact


def _lstm_dataset() -> tuple[list[list[list[float]]], list[int]]:
    sequences: list[list[list[float]]] = []
    labels: list[int] = []
    for index in range(160):
        sequence = [1.0 if ((index + day * 3) % 7) < (2 + index % 5) else 0.0 for day in range(7)]
        sequences.append([[value] for value in sequence])
        labels.append(int(sum(sequence) >= 4))
    return sequences, labels


def _features(signal: HabitSignal) -> list[list[float]]:
    recent_rate = sum(signal.last_7_days) / max(len(signal.last_7_days), 1)
    priority = {'high': 1.0, 'balanced': 0.5, 'low': 0.0}.get(signal.priority.lower(), 0.5)
    goal = {'health': 1.0, 'fitness': 1.0, 'learning': 0.75, 'productivity': 0.75, 'mindfulness': 0.5}.get(signal.goal_type.lower(), 0.5)
    return [[signal.streak, signal.completion_rate, signal.missed_days, recent_rate, signal.average_session_minutes, priority, goal]]


def predict_advanced(signal: HabitSignal) -> dict[str, Any]:
    if not ADVANCED_MODEL_PATH.exists():
        train_advanced_models()
    artifact = joblib.load(ADVANCED_MODEL_PATH)
    values = _features(signal)
    result: dict[str, Any] = {'models_used': list(artifact.get('models_used', []))}

    if 'xgboost' in artifact:
        result['xgboost_probability'] = float(artifact['xgboost'].predict_proba(values)[0][1])
    if 'kmeans' in artifact:
        result['cluster_id'] = int(artifact['kmeans'].predict(values)[0])

    try:
        from statsmodels.tsa.arima.model import ARIMA
        history = np.array(signal.last_7_days, dtype=float)
        model = ARIMA(history, order=(1, 0, 0)).fit()
        result['arima_forecast'] = float(np.clip(model.forecast(steps=1)[0], 0.0, 1.0))
        result['models_used'].append('ARIMA')
    except (ImportError, ValueError, TypeError):
        pass

    if LSTM_MODEL_PATH.exists():
        try:
            import tensorflow as tf
            sequence = np.array(signal.last_7_days[-7:], dtype=float).reshape(1, 7, 1)
            result['lstm_probability'] = float(tf.keras.models.load_model(LSTM_MODEL_PATH, compile=False).predict(sequence, verbose=0)[0][0])
            result['models_used'].append('LSTM')
        except (ImportError, ValueError, OSError, TypeError):
            pass

    result['models_used'] = list(dict.fromkeys(result['models_used']))
    return result


if __name__ == '__main__':
    artifact = train_advanced_models()
    print(f"Saved advanced models: {', '.join(artifact['models_used']) or 'none (optional dependencies unavailable)'}")
