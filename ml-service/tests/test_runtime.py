import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault('ML_SERVICE_API_KEY', 'test-ml-service-key')

from pydantic import ValidationError
from starlette.responses import Response
from fastapi import HTTPException

from app.main import health, liveness, ml_service_api_key, predict_habit_endpoint
from app.schemas import HabitSignal
from app.services.model_training import FEATURE_NAMES, _load_outcome_dataset, train_models
from app.services.predictor import get_model_readiness, predict_habit


class MlRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.assertEqual(ml_service_api_key, 'test-ml-service-key')

    def test_health_endpoint(self):
        response = Response()
        with patch('app.main.is_production', False), patch(
            'app.main.get_model_readiness',
            return_value={'ready': False, 'reason': 'training data approval missing'},
        ):
            result = health(response)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(result['ok'])
        self.assertFalse(result['modelReady'])
        self.assertEqual(result['modelReason'], 'training data approval missing')

    def test_liveness_does_not_depend_on_model_readiness(self):
        self.assertEqual(liveness(), {'ok': True})

    def test_production_health_is_unready_for_bootstrap_model(self):
        response = Response()
        with patch.dict(os.environ, {'NODE_ENV': 'production', 'ML_MODEL_RELEASE_APPROVED': 'false'}), \
                patch('app.main.is_production', True):
            result = health(response)
        self.assertEqual(response.status_code, 503)
        self.assertFalse(result['ok'])
        self.assertFalse(result['modelReady'])
        self.assertEqual(result['modelReason'], 'production model release approval missing')

    def test_production_release_requires_explicit_model_approval(self):
        with patch.dict(os.environ, {'NODE_ENV': 'production', 'ML_MODEL_RELEASE_APPROVED': 'false'}):
            readiness = get_model_readiness()
        self.assertFalse(readiness['ready'])
        self.assertEqual(readiness['reason'], 'production model release approval missing')

    def test_production_prediction_fails_closed_without_approved_evaluation(self):
        with patch.dict(os.environ, {'NODE_ENV': 'production', 'ML_MODEL_RELEASE_APPROVED': 'false'}):
            with self.assertRaisesRegex(RuntimeError, 'approved model and independent holdout evaluation'):
                predict_habit(HabitSignal(habit_name='Reading'))

    def test_production_prediction_route_returns_503_until_approved(self):
        with patch.dict(os.environ, {'NODE_ENV': 'production', 'ML_MODEL_RELEASE_APPROVED': 'false'}):
            with self.assertRaises(HTTPException) as error:
                predict_habit_endpoint(HabitSignal(habit_name='Reading'), 'test-ml-service-key')
        self.assertEqual(error.exception.status_code, 503)

    def test_production_retraining_requires_anonymized_data_attestation(self):
        with patch.dict(os.environ, {'NODE_ENV': 'production', 'ML_TRAINING_DATASET_APPROVED': 'false'}):
            with self.assertRaisesRegex(RuntimeError, 'ML_TRAINING_DATASET_APPROVED=true'):
                train_models()

    def test_matching_approved_holdout_report_marks_model_ready(self):
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / 'model.joblib'
            report_path = Path(directory) / 'evaluation-report.json'
            model_bytes = b'evaluated-model-artifact'
            model_path.write_bytes(model_bytes)
            training_hash = 'a' * 64
            report = {
                'dataset_rows': 100,
                'training_source': 'approved anonymized labeled outcomes',
                'approved': True,
                'training_dataset_sha256': training_hash,
                'evaluation_dataset_sha256': 'b' * 64,
                'artifact_sha256': hashlib.sha256(model_bytes).hexdigest(),
                'models': {
                    'logistic_regression': {'f1': 0.75, 'roc_auc': 0.8},
                    'random_forest': {'f1': 0.76, 'roc_auc': 0.81},
                },
            }
            report_path.write_text(json.dumps(report), encoding='utf-8')
            artifact = {
                'feature_names': FEATURE_NAMES,
                'training_source': 'approved anonymized labeled outcomes',
                'training_dataset_sha256': training_hash,
            }
            with patch.dict(os.environ, {'NODE_ENV': 'production', 'ML_MODEL_RELEASE_APPROVED': 'true'}), \
                    patch('app.services.predictor.MODEL_PATH', model_path), \
                    patch('app.services.predictor.MODEL_EVALUATION_PATH', report_path), \
                    patch('app.services.predictor.joblib.load', return_value=artifact):
                readiness = get_model_readiness()

        self.assertTrue(readiness['ready'], readiness['reason'])

    def test_synthetic_evaluation_is_not_production_ready(self):
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / 'model.joblib'
            report_path = Path(directory) / 'evaluation-report.json'
            model_bytes = b'synthetic-model-artifact'
            model_path.write_bytes(model_bytes)
            training_source = 'approved anonymized labeled outcomes'
            training_hash = 'a' * 64
            report_path.write_text(json.dumps({
                'dataset_rows': 250,
                'training_source': training_source,
                'training_dataset_sha256': training_hash,
                'evaluation_dataset_sha256': 'b' * 64,
                'artifact_sha256': hashlib.sha256(model_bytes).hexdigest(),
                'approved': True,
                'synthetic_demo': True,
                'models': {
                    'logistic_regression': {'f1': 1.0, 'roc_auc': 1.0},
                    'random_forest': {'f1': 1.0, 'roc_auc': 1.0},
                },
            }), encoding='utf-8')
            artifact = {
                'feature_names': FEATURE_NAMES,
                'training_source': training_source,
                'training_dataset_sha256': training_hash,
            }
            with patch.dict(os.environ, {'NODE_ENV': 'production', 'ML_MODEL_RELEASE_APPROVED': 'true'}), \
                    patch('app.services.predictor.MODEL_PATH', model_path), \
                    patch('app.services.predictor.MODEL_EVALUATION_PATH', report_path), \
                    patch('app.services.predictor.joblib.load', return_value=artifact):
                readiness = get_model_readiness()

        self.assertFalse(readiness['ready'])
        self.assertEqual(readiness['reason'], 'synthetic demo evaluation is not production evidence')

    def test_signal_defaults_are_valid(self):
        signal = HabitSignal(habit_name='Reading')
        self.assertEqual(signal.last_7_days, [1, 1, 0, 1, 1, 0, 1])
        self.assertIsNone(signal.average_session_minutes)

    def test_unmeasured_session_duration_uses_training_mean(self):
        class PredictionModel:
            def __init__(self, probability):
                self.probability = probability
                self.values = None

            def predict_proba(self, values):
                self.values = values
                return [[1.0 - self.probability, self.probability]]

        logistic = PredictionModel(0.7)
        logistic.named_steps = {
            'standardscaler': SimpleNamespace(mean_=[0.0, 0.0, 0.0, 0.0, 37.5, 0.0, 0.0]),
        }
        forest = PredictionModel(0.8)
        artifact = {
            'logistic_regression': logistic,
            'random_forest': forest,
        }
        with patch.dict(os.environ, {'NODE_ENV': 'test'}), \
                patch('app.services.predictor._load_models', return_value=artifact), \
                patch('app.services.predictor.predict_advanced', return_value={'models_used': []}):
            result = predict_habit(HabitSignal(habit_name='Reading'))

        self.assertEqual(logistic.values[0][4], 37.5)
        self.assertEqual(forest.values[0][4], 37.5)
        self.assertEqual(result['prediction_source'], 'model')

    def test_last_seven_days_requires_seven_binary_values(self):
        with self.assertRaises(ValidationError):
            HabitSignal(habit_name='Reading', last_7_days=[1, 0, 1])
        with self.assertRaises(ValidationError):
            HabitSignal(habit_name='Reading', last_7_days=[1, 0, 1, 1, 0, 1, 2])

    def test_retraining_requires_anonymized_outcomes_dataset(self):
        with self.assertRaises(RuntimeError):
            _load_outcome_dataset()

    def test_outcome_dataset_rejects_unapproved_personal_columns(self):
        with tempfile.TemporaryDirectory() as directory:
            dataset_path = Path(directory) / 'outcomes.csv'
            dataset_path.write_text(
                'streak,completion_rate,missed_days,last_7_days,average_session_minutes,priority,goal_type,completed_next_7_days,email\n'
                '2,0.5,1,"1,0,1,0,1,0,1",20,balanced,health,1,user@example.org\n',
                encoding='utf-8',
            )
            with self.assertRaisesRegex(ValueError, 'Unexpected columns'):
                _load_outcome_dataset(dataset_path)

    def test_local_model_prediction_identifies_model_source(self):
        result = predict_habit(HabitSignal(habit_name='Reading'))
        self.assertEqual(result['prediction_source'], 'model')
        self.assertFalse(result['is_fallback'])
        self.assertGreaterEqual(result['completion_probability'], 0.0)
        self.assertLessEqual(result['completion_probability'], 1.0)

    def test_missing_model_artifact_uses_deterministic_fallback(self):
        signal = HabitSignal(habit_name='Reading', completion_rate=0.5, streak=3)
        with patch('app.services.predictor._load_models', side_effect=OSError('artifact unavailable')):
            first = predict_habit(signal)
            second = predict_habit(signal)
        self.assertEqual(first, second)
        self.assertEqual(first['prediction_source'], 'fallback')
        self.assertTrue(first['is_fallback'])


if __name__ == '__main__':
    unittest.main()
