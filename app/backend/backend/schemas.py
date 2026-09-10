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
    signal_aspect: str | None = None
    signal_restriction: float | None = None
    sectional_runtime_factor: float | None = None
    downstream_congestion: float | None = None
    route_zone: str | None = None
    train_class: str | None = None


class EventBatch(BaseModel):
    events: list[EventCreate]


class WhatIfRequest(BaseModel):
    train_id: str
    speed_kmph: float | None = None
    delay_min: float | None = None
    congestion: float | None = None
    weather: str | None = None
    signal_restriction: float | None = None
    sectional_runtime_factor: float | None = None
    downstream_congestion: float | None = None


class OtpRequest(BaseModel):
    email: str


class OtpVerifyRequest(BaseModel):
    email: str
    otp: str


class PasswordCreateRequest(BaseModel):
    email: str
    password: str


class PasswordLoginRequest(BaseModel):
    email: str
    password: str


class GeneralTicketRequest(BaseModel):
    session_token: str
    train_id: str
    train_name: str
    boarding_station: str
    destination_station: str
    scheduled_departure: str | None = None
    scheduled_arrival: str | None = None
    journey_duration: str | None = None


class AssistantRequest(BaseModel):
    message: str
    latitude: float | None = None
    longitude: float | None = None
