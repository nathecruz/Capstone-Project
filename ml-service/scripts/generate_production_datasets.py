from __future__ import annotations

import csv
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / 'data'


def generate_rows(seed: int, count: int, label_mode: str) -> list[dict[str, object]]:
    rng = random.Random(seed)
    rows: list[dict[str, object]] = []
    for index in range(count):
        label = 1 if (index % 2 == 0 and label_mode == 'balanced') or (label_mode == 'positive' and index < count * 0.5) else 0
        if label == 1:
            streak = rng.randint(7, 28)
            completion_rate = round(rng.uniform(0.72, 0.98), 2)
            missed_days = rng.randint(0, 3)
            recent_hits = rng.randint(5, 7)
            history = [1] * recent_hits + [1 if rng.random() < 0.7 else 0 for _ in range(7 - recent_hits)]
            average_session_minutes = rng.randint(25, 90)
            priority = rng.choice(['high', 'balanced'])
            goal_type = rng.choice(['health', 'fitness', 'learning', 'productivity'])
        else:
            streak = rng.randint(0, 5)
            completion_rate = round(rng.uniform(0.12, 0.58), 2)
            missed_days = rng.randint(4, 12)
            recent_hits = rng.randint(0, 2)
            history = [0] * recent_hits + [0 if rng.random() < 0.7 else 1 for _ in range(7 - recent_hits)]
            average_session_minutes = rng.randint(10, 40)
            priority = rng.choice(['low', 'balanced'])
            goal_type = rng.choice(['mindfulness', 'productivity', 'learning'])

        rows.append(
            {
                'streak': streak,
                'completion_rate': completion_rate,
                'missed_days': missed_days,
                'last_7_days': ','.join(str(item) for item in history),
                'average_session_minutes': average_session_minutes,
                'priority': priority,
                'goal_type': goal_type,
                'completed_next_7_days': label,
                'synthetic_demo': True,
            }
        )
    return rows


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        'streak',
        'completion_rate',
        'missed_days',
        'last_7_days',
        'average_session_minutes',
        'priority',
        'goal_type',
        'completed_next_7_days',
        'synthetic_demo',
    ]
    with path.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


if __name__ == '__main__':
    training_rows = generate_rows(seed=42, count=500, label_mode='balanced')
    holdout_rows = generate_rows(seed=99, count=250, label_mode='balanced')
    write_csv(DATA_DIR / 'synthetic_training_demo.csv', training_rows)
    write_csv(DATA_DIR / 'synthetic_holdout_demo.csv', holdout_rows)
    print(f'Created {len(training_rows)} synthetic demo rows at {DATA_DIR / "synthetic_training_demo.csv"}')
    print(f'Created {len(holdout_rows)} synthetic demo rows at {DATA_DIR / "synthetic_holdout_demo.csv"}')
    print(f'Training positives={sum(int(row["completed_next_7_days"]) for row in training_rows)}')
    print(f'Holdout positives={sum(int(row["completed_next_7_days"]) for row in holdout_rows)}')
