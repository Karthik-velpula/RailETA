"""Train and serve the ETA model used by the demo API.

The simulator supplies the same feature contract that a future railway feed can
populate. The training data is synthetic because official operational data is
not available for this prototype.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split
from xgboost import XGBRegressor

FEATURES = [
    "speed_kmph",
    "delay_min",
    "congestion",
    "weather_code",
    "distance_km",
    "hour_sin",
    "hour_cos",
    "signal_restriction",
    "sectional_runtime_factor",
    "downstream_congestion",
    "historical_delay_min",
    "route_zone_code",
    "train_class_code",
]
MODEL_SCHEMA_VERSION = 2
WEATHER_CODES = {"Clear": 0.0, "Cloudy": 0.25, "Rain": 0.65, "Fog": 0.85, "Heavy Rain": 1.0}
MODEL_PATH = Path(__file__).resolve().parent.parent / "model_artifacts" / "eta_xgb.joblib"


def _weather_code(weather: str) -> float:
    return WEATHER_CODES.get(weather, 0.35)


def build_features(*, speed_kmph: float, delay_min: float, congestion: float, weather: str, distance_km: float, hour: int, signal_restriction: float = 0, sectional_runtime_factor: float = 1, downstream_congestion: float = 0, historical_delay_min: float = 0, route_zone: str = "", train_class: str = "") -> pd.DataFrame:
    angle = (hour % 24) / 24 * math.tau
    return pd.DataFrame([{
        "speed_kmph": speed_kmph,
        "delay_min": delay_min,
        "congestion": congestion,
        "weather_code": _weather_code(weather),
        "distance_km": distance_km,
        "hour_sin": math.sin(angle),
        "hour_cos": math.cos(angle),
        "signal_restriction": signal_restriction,
        "sectional_runtime_factor": sectional_runtime_factor,
        "downstream_congestion": downstream_congestion,
        "historical_delay_min": historical_delay_min,
        "route_zone_code": (sum(map(ord, route_zone)) % 17) / 17,
        "train_class_code": (sum(map(ord, train_class)) % 11) / 11,
    }], columns=FEATURES)


def train_model(path: Path = MODEL_PATH, seed: int = 42) -> dict:
    rng = random.Random(seed)
    rows = []
    for _ in range(2400):
        speed = rng.uniform(35, 110)
        delay = rng.uniform(0, 55)
        congestion = rng.uniform(0.02, 0.95)
        weather = rng.choice(list(WEATHER_CODES))
        distance = rng.uniform(8, 58)
        hour = rng.randrange(24)
        signal = rng.choice([0, 0, .2, .45, 1])
        section_factor = rng.uniform(.88, 1.35)
        downstream = rng.uniform(0, .95)
        historic = rng.uniform(0, 35)
        weather_penalty = _weather_code(weather) * 9
        target = (distance / max(speed, 25)) * 60 * section_factor + delay * .22 + congestion * 8 + downstream * 11 + signal * 12 + historic * .12 + weather_penalty
        target += rng.gauss(0, 1.7)
        rows.append({**build_features(speed_kmph=speed, delay_min=delay, congestion=congestion, weather=weather, distance_km=distance, hour=hour, signal_restriction=signal, sectional_runtime_factor=section_factor, downstream_congestion=downstream, historical_delay_min=historic, route_zone=rng.choice(["SCR", "SR", "NR", "WR"]), train_class=rng.choice(["Express", "Passenger", "Superfast"])).iloc[0].to_dict(), "target": max(4.0, target)})

    data = pd.DataFrame(rows)
    x_train, x_test, y_train, y_test = train_test_split(data[FEATURES], data["target"], test_size=0.2, random_state=seed)
    model = XGBRegressor(
        n_estimators=260,
        max_depth=5,
        learning_rate=0.06,
        subsample=0.9,
        colsample_bytree=0.9,
        objective="reg:squarederror",
        random_state=seed,
        n_jobs=2,
    )
    model.fit(x_train, y_train)
    mae = float(mean_absolute_error(y_test, model.predict(x_test)))
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "features": FEATURES, "schema_version": MODEL_SCHEMA_VERSION, "mae_minutes": round(mae, 2), "training_rows": len(data)}, path)
    return {"path": str(path), "mae_minutes": round(mae, 2), "training_rows": len(data)}


class EtaModel:
    def __init__(self, path: Path = MODEL_PATH):
        self.path = path
        self.bundle = None

    def load(self) -> None:
        if not self.path.exists():
            train_model(self.path)
        self.bundle = joblib.load(self.path)
        if self.bundle.get("schema_version") != MODEL_SCHEMA_VERSION:
            train_model(self.path)
            self.bundle = joblib.load(self.path)

    def predict(self, *, speed_kmph: float, delay_min: float, congestion: float, weather: str, distance_km: float, hour: int, **context: float | str) -> float:
        if self.bundle is None:
            self.load()
        features = build_features(speed_kmph=speed_kmph, delay_min=delay_min, congestion=congestion, weather=weather, distance_km=distance_km, hour=hour, **context)
        return max(3.0, float(self.bundle["model"].predict(features)[0]))

    @property
    def metadata(self) -> dict:
        if self.bundle is None:
            self.load()
        return {"model": "XGBRegressor", "artifact": self.path.name, "maeMinutes": self.bundle["mae_minutes"], "trainingRows": self.bundle["training_rows"], "featureSchemaVersion": MODEL_SCHEMA_VERSION}
