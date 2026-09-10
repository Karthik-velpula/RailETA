import json
import random
from datetime import datetime, timedelta, timezone

import numpy as np
from sqlalchemy.orm import Session

from .models import TrainEvent, TrainState
from .schemas import EventCreate, WhatIfRequest

STATIONS = [
    "Chennai Central",
    "Katpadi",
    "Jolarpettai",
    "Salem",
    "Erode",
    "Tiruppur",
    "Coimbatore",
]


def _eta_minutes(state: TrainState) -> float:
    base = max(18, 240 / max(state.speed_kmph, 20))
    weather_penalty = {"Clear": 0, "Rain": 8, "Fog": 12, "Heavy Rain": 18}.get(state.weather, 4)
    congestion_penalty = state.congestion * 20
    delay = max(state.delay_min, 0)
    return base + weather_penalty + congestion_penalty + delay * 0.75


def _prediction_payload(state: TrainState) -> dict:
    eta_min = _eta_minutes(state)
    confidence = max(0.5, 0.96 - state.congestion * 0.2 - min(state.delay_min / 120, 0.25))
    now = datetime.now(timezone.utc)
    return {
        "trainId": state.train_id,
        "trainName": state.train_name,
        "currentStation": state.current_station,
        "nextStation": state.next_station,
        "section": state.section,
        "latitude": state.latitude,
        "longitude": state.longitude,
        "speedKmph": state.speed_kmph,
        "delayMin": round(state.delay_min, 1),
        "weather": state.weather,
        "congestion": round(state.congestion, 2),
        "predictedEtaMinutes": round(eta_min, 1),
        "predictedArrivalAtNextStation": (now + timedelta(minutes=eta_min)).isoformat(),
        "destinationEta": (now + timedelta(minutes=eta_min * 4.7)).isoformat(),
        "confidence": round(confidence, 2),
        "etaRangeMinutes": [round(max(eta_min - 6, 3), 1), round(eta_min + 9, 1)],
        "updatedAt": now.isoformat(),
    }


def seed_demo(session: Session) -> TrainState:
    state = TrainState(
        train_id="12603",
        train_name="Chennai Central - Coimbatore Intercity",
        current_station=STATIONS[0],
        next_station=STATIONS[1],
        latitude=13.0827,
        longitude=80.2707,
        speed_kmph=72.0,
        delay_min=6.0,
        section=f"{STATIONS[0]} → {STATIONS[1]}",
        weather="Clear",
        congestion=0.18,
        destination_station=STATIONS[-1],
        updated_at=datetime.utcnow(),
    )
    session.add(state)
    session.flush()
    return state


def get_or_seed(session: Session) -> TrainState:
    state = session.query(TrainState).filter_by(train_id="12603").one_or_none()
    if state:
        return state
    return seed_demo(session)


def compute_prediction(session: Session, train_id: str) -> dict:
    state = session.query(TrainState).filter_by(train_id=train_id).one_or_none() or get_or_seed(session)
    return _prediction_payload(state)


def ingest_event(session: Session, payload: EventCreate) -> dict:
    state = session.query(TrainState).filter_by(train_id=payload.train_id).one_or_none() or get_or_seed(session)
    for field in ["latitude", "longitude", "speed_kmph", "delay_min", "weather", "congestion"]:
        value = getattr(payload, field)
        if value is not None:
            setattr(state, field, value)
    state.updated_at = datetime.utcnow()
    session.add(TrainEvent(train_id=payload.train_id, event_type=payload.event_type, payload_json=payload.model_dump_json()))
    return {"type": "event", "prediction": _prediction_payload(state)}


def get_dashboard_snapshot(session: Session) -> dict:
    state = get_or_seed(session)
    prediction = _prediction_payload(state)
    history = [
        {"time": (datetime.now(timezone.utc) - timedelta(minutes=i * 4)).isoformat(), "eta": round(prediction["predictedEtaMinutes"] + np.sin(i / 2) * 3 + i, 1)}
        for i in range(8)
    ]
    alerts = [
        {"level": "info", "message": "DEMO MODE — Simulated operational data"},
        {"level": "warning", "message": f"Current delay detected: {state.delay_min:.0f} min"},
    ]
    return {"train": prediction, "history": history, "alerts": alerts, "stations": STATIONS}


class Simulator:
    async def ensure_seeded(self) -> None:
        return None

    async def tick(self, session: Session) -> dict:
        state = get_or_seed(session)
        state.longitude += 0.015 + random.random() * 0.01
        state.latitude += 0.001 + random.random() * 0.001
        state.speed_kmph = max(42.0, min(95.0, state.speed_kmph + random.uniform(-4, 5)))
        state.delay_min = max(0.0, state.delay_min + random.uniform(-1.2, 2.4))
        state.congestion = min(0.95, max(0.05, state.congestion + random.uniform(-0.04, 0.05)))
        state.weather = random.choice(["Clear", "Cloudy", "Rain"])
        idx = min(len(STATIONS) - 2, int((state.longitude - 80.27) / 0.03))
        state.current_station = STATIONS[idx]
        state.next_station = STATIONS[idx + 1]
        state.section = f"{state.current_station} → {state.next_station}"
        state.updated_at = datetime.utcnow()
        return {"type": "tick", "prediction": _prediction_payload(state)}

    def what_if(self, session: Session, payload: WhatIfRequest) -> dict:
        state = session.query(TrainState).filter_by(train_id=payload.train_id).one_or_none() or get_or_seed(session)
        temp = TrainState(**{c.name: getattr(state, c.name) for c in state.__table__.columns})
        for field in ["speed_kmph", "delay_min", "congestion", "weather"]:
            value = getattr(payload, field)
            if value is not None:
                setattr(temp, field, value)
        return {"scenario": _prediction_payload(temp)}
