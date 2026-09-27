from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

FEATURE_NAMES = [
    'streak',
    'completion_rate',
    'missed_days',
    'recent_completion_rate',
    'average_session_minutes',
    'priority_score',
    'goal_type_score',
]
MODEL_PATH = Path(__file__).resolve().parents[2] / 'models' / 'habit_models.joblib'
MODEL_EVALUATION_PATH = Path(os.getenv('ML_MODEL_EVALUATION_REPORT', str(MODEL_PATH.with_name('evaluation-report.json'))))
MINIMUM_EVALUATION_ROWS = 100
MINIMUM_F1 = 0.65
MINIMUM_ROC_AUC = 0.7
REQUIRED_OUTCOME_COLUMNS = {
    'streak', 'completion_rate', 'missed_days', 'last_7_days',
    'average_session_minutes', 'priority', 'goal_type', 'completed_next_7_days',
}


def _parse_history(value: object) -> list[float]:
    history = [float(item.strip()) for item in str(value).split(',') if item.strip()]
    if len(history) != 7 or any(item not in (0.0, 1.0) for item in history):
        raise ValueError('last_7_days must contain exactly seven comma-separated 0/1 values')
    return history


def _load_outcome_dataset(dataset_path: Path | None = None) -> tuple[list[list[float]], list[int], int]:
    configured_path = dataset_path or (Path(os.environ['ML_TRAINING_DATASET']) if os.getenv('ML_TRAINING_DATASET') else None)
    if configured_path is None:
        raise RuntimeError('ML_TRAINING_DATASET must point to an approved anonymized outcomes CSV before retraining.')
    if not configured_path.is_file():
        raise FileNotFoundError(f'ML training dataset not found: {configured_path}')

    data = pd.read_csv(configured_path)
    missing = REQUIRED_OUTCOME_COLUMNS - set(data.columns)
    if missing:
        raise ValueError(f'Missing required outcome columns: {", ".join(sorted(missing))}')
    unexpected = set(data.columns) - REQUIRED_OUTCOME_COLUMNS
    if unexpected:
        raise ValueError(f'Unexpected columns are not allowed in the anonymized outcome dataset: {", ".join(sorted(unexpected))}')
    unexpected = set(data.columns) - REQUIRED_OUTCOME_COLUMNS
    if unexpected:
        raise ValueError(f'Unexpected columns are not allowed in the anonymized outcome dataset: {", ".join(sorted(unexpected))}')
    if data.empty:
        raise ValueError('The ML training dataset must contain at least one row')

    features: list[list[float]] = []
    labels: list[int] = []
    for row_number, row in data.iterrows():
        history = _parse_history(row['last_7_days'])
        completion_rate = float(row['completion_rate'])
        label = int(row['completed_next_7_days'])
        if not 0 <= completion_rate <= 1 or label not in (0, 1):
            raise ValueError(f'Invalid completion rate or outcome label at row {row_number}')
        features.append([
            float(row['streak']), completion_rate, float(row['missed_days']), sum(history) / 7.0,
            float(row['average_session_minutes']),
            {'high': 1.0, 'balanced': 0.5, 'low': 0.0}.get(str(row['priority']).lower(), 0.5),
            {'health': 1.0, 'fitness': 1.0, 'learning': 0.75, 'productivity': 0.75, 'mindfulness': 0.5}.get(str(row['goal_type']).lower(), 0.5),
        ])
        labels.append(label)
    if len(set(labels)) < 2:
        raise ValueError('The ML training dataset must contain both outcome classes: 0 and 1')
    return features, labels, len(data)


def train_models(dataset_path: Path | None = None) -> dict[str, Any]:
    is_production = os.getenv('NODE_ENV', '').lower() == 'production'
    dataset_approved = os.getenv('ML_TRAINING_DATASET_APPROVED', '').lower() == 'true'
    if is_production and not dataset_approved:
        raise RuntimeError('Set ML_TRAINING_DATASET_APPROVED=true only after confirming the outcomes dataset is approved and anonymized.')

    configured_path = dataset_path or (Path(os.environ['ML_TRAINING_DATASET']) if os.getenv('ML_TRAINING_DATASET') else None)
    if configured_path is None:
        raise RuntimeError('ML_TRAINING_DATASET must point to an approved anonymized outcomes CSV before retraining.')
    features, labels, training_samples = _load_outcome_dataset(configured_path)
    logistic = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, random_state=42))
    forest = RandomForestClassifier(n_estimators=160, max_depth=8, random_state=42, class_weight='balanced')
    logistic.fit(features, labels)
    forest.fit(features, labels)

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    artifact = {
        'feature_names': FEATURE_NAMES,
        'logistic_regression': logistic,
        'random_forest': forest,
        'feature_means': {
            'average_session_minutes': sum(row[FEATURE_NAMES.index('average_session_minutes')] for row in features) / len(features),
        },
        'training_samples': training_samples,
        'training_source': 'approved anonymized labeled outcomes' if dataset_approved else 'anonymized labeled outcomes; approval not attested',
        'training_dataset_sha256': hashlib.sha256(configured_path.read_bytes()).hexdigest(),
    }
    joblib.dump(artifact, MODEL_PATH)
    return artifact


if __name__ == '__main__':
    artifact = train_models()
    print(f"Saved {artifact['training_samples']} training samples to {MODEL_PATH}")
