import os
from contextlib import contextmanager

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "mysql+mysqlconnector://rail:rail@mysql:3306/raileta")
engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


def init_db() -> None:
    from . import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    # Existing local databases may have been created before OTP hashes used
    # scrypt. Expanding the column preserves records and avoids truncation.
    columns = {column["name"]: column for column in inspect(engine).get_columns("email_otp_challenges")}
    if columns.get("otp_hash", {}).get("type").length < 256:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE email_otp_challenges MODIFY otp_hash VARCHAR(256) NOT NULL"))
    ticket_columns = {column["name"] for column in inspect(engine).get_columns("general_tickets")}
    required_ticket_columns = {
        "scheduled_departure": "VARCHAR(64) NOT NULL DEFAULT 'Scheduled time unavailable'",
        "scheduled_arrival": "VARCHAR(64) NOT NULL DEFAULT 'Scheduled time unavailable'",
        "journey_duration": "VARCHAR(64) NOT NULL DEFAULT 'Duration unavailable'",
    }
    with engine.begin() as connection:
        for name, definition in required_ticket_columns.items():
            if name not in ticket_columns:
                connection.execute(text(f"ALTER TABLE general_tickets ADD COLUMN {name} {definition}"))
    state_columns = {column["name"] for column in inspect(engine).get_columns("train_states")}
    required_state_columns = {
        "signal_restriction": "FLOAT NOT NULL DEFAULT 0",
        "sectional_runtime_factor": "FLOAT NOT NULL DEFAULT 1",
        "downstream_congestion": "FLOAT NOT NULL DEFAULT 0",
        "route_zone": "VARCHAR(64) NOT NULL DEFAULT 'South Central'",
        "train_class": "VARCHAR(32) NOT NULL DEFAULT 'Express'",
    }
    with engine.begin() as connection:
        for name, definition in required_state_columns.items():
            if name not in state_columns:
                connection.execute(text(f"ALTER TABLE train_states ADD COLUMN {name} {definition}"))


@contextmanager
def session_scope():
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
