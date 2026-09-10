from pydantic import BaseModel


class EventCreate(BaseModel):
    train_id: str
    event_type: str
    latitude: float | None = None
    longitude: float | None = None
    speed_kmph: float | None = None
    delay_min: float | None = None
    weather: str | None = None
    congestion: float | None = None


class WhatIfRequest(BaseModel):
    train_id: str
    speed_kmph: float | None = None
    delay_min: float | None = None
    congestion: float | None = None
    weather: str | None = None
