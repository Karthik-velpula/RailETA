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
    destination_station: Mapped[str] = mapped_column(String(128))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TrainEvent(Base):
    __tablename__ = "train_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    train_id: Mapped[str] = mapped_column(String(32), index=True)
    event_type: Mapped[str] = mapped_column(String(64))
    payload_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
