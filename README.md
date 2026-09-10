# RailETA AI

Dynamic ETA forecasting prototype for SIH 2026 problem statement 26028.

## Included

- React + TypeScript + Vite frontend
- FastAPI backend with WebSocket updates
- SQLAlchemy models ready for MySQL 8
- Real-time simulator for demo mode plus configurable live GPS provider
- Operational ingress APIs for GPS, signal aspects, sectional running factors, downstream congestion, and dispatch events
- Cached live weather enrichment (Open-Meteo) for selected live trains, including observation time, temperature, precipitation, and wind
- Synthetic-data training pipeline with persisted `XGBRegressor` Joblib artifact
- Automatic model loading/training on backend startup
- Separate passenger and control-room routes
- Leaflet/OpenStreetMap live corridor map, alert severity, what-if analysis, and Recharts telemetry
- Docker Compose deployment

## Run locally

Backend:

```bash
cd app/backend
python -m uvicorn backend.app:app --reload --port 8000
```

Frontend:

```bash
cd app/frontend
npm install
npm run dev
```

## Run with Docker

```bash
docker compose up --build
```

With the current local port layout, open the frontend at `http://localhost:5174`; the API is available at `http://localhost:8001`.

## Booking email OTP

The Passenger `Book ticket` button opens a RailETA account flow: email OTP, verification, and password creation. User accounts and one-time codes are stored in MySQL; passwords and OTPs are hashed, OTPs expire after 10 minutes, and verification attempts are limited.

To enable real Gmail delivery, copy the SMTP entries from `.env.example` into the ignored root `.env` file and set:

- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`
- `SMTP_USERNAME` and `SMTP_FROM` to the sending Gmail address
- `SMTP_PASSWORD` to a Google App Password, not the normal Gmail password

Create the App Password in the Google Account security settings after enabling two-step verification. Restart `docker compose up -d --build backend` after editing `.env`.

## Demo notes

- The app intentionally shows `DEMO MODE — Simulated operational data`
- Normal operation is automatic; manual actions are only for simulation and what-if analysis

## ML pipeline

The prototype uses synthetic operational records because internal railway APIs are not available. The feature contract is ready for a real source: GPS/speed, current delay, congestion, live weather, signal restriction, sectional running factor, downstream congestion, historical delay, route zone, train class, section distance, and time-of-day are passed into an XGBoost ETA regressor.

## Operational feed contract and scale-out

`POST /api/ingest/operational-event` accepts a normalized update from a GPS, signalling, dispatch, sectional-runtime, or congestion adapter. `POST /api/ingest/operational-events` accepts batches of up to 1,000 updates, so an external Kafka/Redis/SQS consumer can flush partitioned batches without changing the prediction API. The current Docker demo runs one API worker; deploy multiple workers behind a load balancer with a shared MySQL/Redis event consumer for thousands of simultaneous trains. Signal aspects are normalized as `GREEN`, `DOUBLE_YELLOW`, `YELLOW`, `RED`, or `STOP` (or a 0–1 `signal_restriction`).

`GET /api/weather/current?latitude=...&longitude=...` returns the current Open-Meteo observation. Live train requests automatically attach the same observation as `weatherObservation`; it is cached for two minutes per approximately 10 km area to balance freshness and provider reliability.

To train the model explicitly:

```bash
cd app/backend
python scripts/train_model.py
```

This writes `model_artifacts/eta_xgb.joblib`. If the artifact is missing, the FastAPI startup hook trains it automatically. Model metadata is available at `GET /api/model`.

## Routes

- `/passenger`: next-station ETA, expected window, station-by-station journey board, and prediction trend
- `/control`: live map, active alerts, simulator/event controls, what-if analysis, model health, and telemetry charts
