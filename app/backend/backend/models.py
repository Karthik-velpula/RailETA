from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class TrainState(Base):
    __tablename__ = "train_states"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    train_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    train_name: Mapped[str] = mapped_column(String(128))
    current_station: Mapped[str] = mapped_column(String(128))
    next_station: Mapped[str] = mapped_column(String(128))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    speed_kmph: Mapped[float] = mapped_column(Float)
    delay_min: Mapped[float] = mapped_column(Float)
    section: Mapped[str] = mapped_column(String(128))
    weather: Mapped[str] = mapped_column(String(128))
    congestion: Mapped[float] = mapped_column(Float)
    # Inputs supplied by operational adapters.  Values are normalized to
    # 0..1 so every railway zone/provider has the same ETA feature contract.
    signal_restriction: Mapped[float] = mapped_column(Float, default=0.0)
    sectional_runtime_factor: Mapped[float] = mapped_column(Float, default=1.0)
    downstream_congestion: Mapped[float] = mapped_column(Float, default=0.0)
    route_zone: Mapped[str] = mapped_column(String(64), default="South Central")
    train_class: Mapped[str] = mapped_column(String(32), default="Express")
    destination_station: Mapped[str] = mapped_column(String(128))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TrainEvent(Base):
    __tablename__ = "train_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    train_id: Mapped[str] = mapped_column(String(32), index=True)
    event_type: Mapped[str] = mapped_column(String(64))
    payload_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class BookingUser(Base):
    __tablename__ = "booking_users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class EmailOtpChallenge(Base):
    __tablename__ = "email_otp_challenges"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    otp_hash: Mapped[str] = mapped_column(String(256))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class BookingSession(Base):
    __tablename__ = "booking_sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    token_hash: Mapped[str] = mapped_column(String(256), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class GeneralTicket(Base):
    __tablename__ = "general_tickets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booking_reference: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    train_id: Mapped[str] = mapped_column(String(32))
    train_name: Mapped[str] = mapped_column(String(160))
    boarding_station: Mapped[str] = mapped_column(String(160))
    destination_station: Mapped[str] = mapped_column(String(160))
    scheduled_departure: Mapped[str] = mapped_column(String(64), default="Scheduled time unavailable")
    scheduled_arrival: Mapped[str] = mapped_column(String(64), default="Scheduled time unavailable")
    journey_duration: Mapped[str] = mapped_column(String(64), default="Duration unavailable")
    travel_class: Mapped[str] = mapped_column(String(32), default="General")
    status: Mapped[str] = mapped_column(String(32), default="Demo confirmed")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
