from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parents[1]
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from app.services.model_training import train_models


def main() -> None:
    project_root = Path(__file__).resolve().parents[1]
    print('This command prepares a production-ready ML artifact from an approved anonymized dataset.')
    print('It requires two CSV files: one approved training set and one independent holdout set.')

    training_dataset = Path(os.environ.get('ML_TRAINING_DATASET', '')).expanduser().resolve()
    evaluation_dataset = Path(os.environ.get('ML_EVALUATION_DATASET', '')).expanduser().resolve()
    if not training_dataset.is_file():
        raise FileNotFoundError('Set ML_TRAINING_DATASET to the approved anonymized training CSV before running this command.')
    if not evaluation_dataset.is_file():
        raise FileNotFoundError('Set ML_EVALUATION_DATASET to the independent holdout evaluation CSV before running this command.')

    os.environ['NODE_ENV'] = 'production'
    os.environ['ML_TRAINING_DATASET'] = str(training_dataset)
    os.environ['ML_TRAINING_DATASET_APPROVED'] = 'true'

    train_models(training_dataset)
    report_path = project_root / 'models' / 'evaluation-report.json'
    env = os.environ.copy()
    pythonpath = env.get('PYTHONPATH')
    env['PYTHONPATH'] = str(project_root) if not pythonpath else str(project_root) + os.pathsep + pythonpath
    subprocess.run(
        [
            sys.executable,
            str(project_root / 'scripts' / 'evaluate_models.py'),
            '--dataset',
            str(evaluation_dataset),
            '--output',
            str(report_path),
            '--approved-anonymized',
        ],
        cwd=str(project_root),
        env=env,
        check=True,
    )

    print(f'Production model training completed successfully. Artifact: {project_root / "models" / "habit_models.joblib"}')
    print(f'Evaluation report: {report_path}')


if __name__ == '__main__':
    main()
