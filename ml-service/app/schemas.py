from typing import List, Literal

from pydantic import BaseModel, Field


class HabitSignal(BaseModel):
    habit_name: str = Field(..., min_length=1)
    streak: int = Field(default=0, ge=0)
    completion_rate: float = Field(default=0.0, ge=0.0, le=1.0)
    missed_days: int = Field(default=0, ge=0)
    last_7_days: List[Literal[0, 1]] = Field(default_factory=lambda: [1, 1, 0, 1, 1, 0, 1], min_length=7, max_length=7)
    average_session_minutes: int | None = Field(default=None, ge=0)
    priority: str = Field(default="balanced")
    goal_type: str = Field(default="health")


class HabitPredictionResponse(BaseModel):
    habit_name: str
    completion_probability: float
    dropout_risk: float
    confidence: float
    recommended_action: str
    suggested_reminder_time: str
    summary: str
    models_used: List[str] = Field(default_factory=list)
    prediction_source: Literal['model', 'fallback'] = 'model'
    is_fallback: bool = False
    cluster_id: int | None = None
    arima_forecast: float | None = None
    lstm_probability: float | None = None
    xgboost_probability: float | None = None
