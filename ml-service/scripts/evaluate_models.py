from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score

from app.services.model_training import (
    FEATURE_NAMES,
    MINIMUM_EVALUATION_ROWS,
    MINIMUM_F1,
    MINIMUM_ROC_AUC,
    MODEL_PATH,
    REQUIRED_OUTCOME_COLUMNS,
)


def priority_score(value: str) -> float:
    return {'high': 1.0, 'balanced': 0.5, 'low': 0.0}.get(str(value).lower(), 0.5)


def goal_type_score(value: str) -> float:
    return {
        'health': 1.0,
        'fitness': 1.0,
        'learning': 0.75,
        'productivity': 0.75,
        'mindfulness': 0.5,
    }.get(str(value).lower(), 0.5)


def parse_history(value: str) -> list[float]:
    history = [float(item.strip()) for item in str(value).split(',') if item.strip()]
    if len(history) != 7 or any(item not in (0.0, 1.0) for item in history):
        raise ValueError('last_7_days must contain exactly seven comma-separated 0/1 values')
    return history


def build_features(data: pd.DataFrame) -> list[list[float]]:
    features: list[list[float]] = []
    for row_number, row in data.iterrows():
        history = parse_history(row['last_7_days'])
        features.append([
            float(row['streak']),
            float(row['completion_rate']),
            float(row['missed_days']),
            sum(history) / 7.0,
            float(row['average_session_minutes']),
            priority_score(row['priority']),
            goal_type_score(row['goal_type']),
        ])
        if not 0 <= features[-1][1] <= 1:
            raise ValueError(f'completion_rate must be between 0 and 1 at row {row_number}')
    return features


def evaluate_model(model, features, labels) -> dict[str, float]:
    predictions = model.predict(features)
    probabilities = model.predict_proba(features)[:, 1]
    result = {
        'accuracy': round(float(accuracy_score(labels, predictions)), 4),
        'precision': round(float(precision_score(labels, predictions, zero_division=0)), 4),
        'recall': round(float(recall_score(labels, predictions, zero_division=0)), 4),
        'f1': round(float(f1_score(labels, predictions, zero_division=0)), 4),
    }
    if len(set(labels)) == 2:
        result['roc_auc'] = round(float(roc_auc_score(labels, probabilities)), 4)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description='Evaluate HabitAI models on anonymized real outcome data.')
    parser.add_argument('--dataset', required=True, type=Path, help='CSV containing anonymized habit outcomes')
    parser.add_argument('--output', type=Path, default=Path('evaluation-report.json'))
    parser.add_argument('--approved-anonymized', action='store_true', help='Attest that the holdout dataset is approved and anonymized')
    args = parser.parse_args()

    data = pd.read_csv(args.dataset)
    missing = REQUIRED_OUTCOME_COLUMNS - set(data.columns)
    if missing:
        raise ValueError(f'Missing required columns: {", ".join(sorted(missing))}')
    unexpected = set(data.columns) - REQUIRED_OUTCOME_COLUMNS
    if unexpected:
        raise ValueError(f'Unexpected columns are not allowed in the anonymized outcome dataset: {", ".join(sorted(unexpected))}')
    if data.empty:
        raise ValueError('The evaluation dataset must contain at least one row')
    if len(data) < MINIMUM_EVALUATION_ROWS:
        raise ValueError(f'The holdout evaluation dataset must contain at least {MINIMUM_EVALUATION_ROWS} rows')

    labels = data['completed_next_7_days'].astype(int).tolist()
    if any(label not in (0, 1) for label in labels):
        raise ValueError('completed_next_7_days must contain only 0 or 1')
    if len(set(labels)) != 2:
        raise ValueError('The holdout evaluation dataset must contain both outcome classes: 0 and 1')

    artifact = joblib.load(MODEL_PATH)
    if artifact.get('training_source') != 'approved anonymized labeled outcomes':
        raise ValueError('The trained artifact was not trained on an approved anonymized outcome dataset')
    training_dataset_hash = artifact.get('training_dataset_sha256')
    evaluation_dataset_hash = hashlib.sha256(args.dataset.read_bytes()).hexdigest()
    if evaluation_dataset_hash == training_dataset_hash:
        raise ValueError('Evaluation must use an independent holdout dataset')
    features = build_features(data)
    models = {
        name: evaluate_model(artifact[name], features, labels)
        for name in ('logistic_regression', 'random_forest')
        if name in artifact
    }
    if set(models) != {'logistic_regression', 'random_forest'}:
        raise ValueError('The trained artifact is missing one or more required production models')
    quality_passed = all(
        metrics.get('f1', 0.0) >= MINIMUM_F1 and metrics.get('roc_auc', 0.0) >= MINIMUM_ROC_AUC
        for metrics in models.values()
    )
    report = {
        'dataset_rows': len(data),
        'feature_names': FEATURE_NAMES,
        'training_source': artifact['training_source'],
        'training_dataset_sha256': training_dataset_hash,
        'evaluation_dataset_sha256': evaluation_dataset_hash,
        'artifact_sha256': hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest(),
        'approved': args.approved_anonymized and quality_passed,
        'minimum_evaluation_rows': MINIMUM_EVALUATION_ROWS,
        'minimum_f1': MINIMUM_F1,
        'minimum_roc_auc': MINIMUM_ROC_AUC,
        'quality_passed': quality_passed,
        'models': models,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
