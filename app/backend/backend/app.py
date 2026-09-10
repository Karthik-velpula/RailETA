import asyncio
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db, session_scope
from .railradar import railradar
from .operational_feeds import weather_observation
from .auth_service import _send_otp, _send_ticket_email, account_status, create_general_ticket, create_password, request_otp, sign_in, verify_otp
from .assistant_service import answer as assistant_answer
from .schemas import AssistantRequest, EventBatch, EventCreate, GeneralTicketRequest, OtpRequest, OtpVerifyRequest, PasswordCreateRequest, PasswordLoginRequest, WhatIfRequest
from .services import Simulator, compute_prediction, eta_model, get_dashboard_snapshot, get_fleet_predictions, get_live_map_snapshot, get_real_train_directory, ingest_event, refresh_live_prediction, search_stations, search_trains_between

app = FastAPI(title="RailETA AI API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://127.0.0.1:5173", "http://127.0.0.1:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

simulator = Simulator()
connections: set[WebSocket] = set()


@app.on_event("startup")
async def startup() -> None:
    init_db()
    eta_model.load()
    await simulator.ensure_seeded()
    # Populate the provider directory before the first passenger types a query.
    # This runs off the event loop, so API startup remains responsive.
    railradar.refresh_train_directory_async()
    railradar.refresh_live_map_async()
    async def loop() -> None:
        while True:
            await asyncio.sleep(1)
            with session_scope() as session:
                payload = await simulator.tick(session)
            await broadcast(payload)
    asyncio.create_task(loop())


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "mode": "demo", "model": eta_model.metadata["model"]}


@app.get("/api/model")
def model_info() -> dict[str, Any]:
    return eta_model.metadata


@app.get("/api/dashboard")
def dashboard() -> dict[str, Any]:
    live_network = get_live_map_snapshot(limit=10000)
    with session_scope() as session:
        return get_dashboard_snapshot(session, live_network)


@app.get("/api/trains/{train_id}")
def train_detail(train_id: str, live: bool = Query(False)) -> dict[str, Any]:
    with session_scope() as session:
        return refresh_live_prediction(session, train_id) if live else compute_prediction(session, train_id)


@app.get("/api/trains")
def trains() -> dict[str, Any]:
    with session_scope() as session:
        fleet = get_fleet_predictions(session)
        return {"trains": fleet, "count": len(fleet)}


@app.get("/api/catalog/trains")
def train_catalog(query: str = "", page: int = Query(1, ge=1), page_size: int = Query(50, ge=10, le=100)) -> dict[str, Any]:
    return get_real_train_directory(query=query, page=page, page_size=page_size)


@app.get("/api/network/live")
def live_network(limit: int = Query(10000, ge=1, le=10000)) -> dict[str, Any]:
    return get_live_map_snapshot(limit=limit)


@app.get("/api/weather/current")
def current_weather(latitude: float = Query(..., ge=6, le=38), longitude: float = Query(..., ge=68, le=98)) -> dict[str, Any]:
    """Current weather observation for a rail location, refreshed at most every two minutes."""
    return weather_observation(latitude, longitude)


@app.get("/api/stations/search")
def station_search(query: str = Query(..., min_length=2)) -> dict[str, Any]:
    return search_stations(query)


@app.get("/api/passenger/search")
def passenger_search(origin: str = "", destination: str = "", live: bool = Query(True)) -> dict[str, Any]:
    return search_trains_between(origin, destination, live=live)


@app.post("/api/assistant/chat")
def assistant_chat(payload: AssistantRequest) -> dict[str, Any]:
    with session_scope() as session:
        return assistant_answer(session, payload.message, payload.latitude, payload.longitude)


@app.post("/api/auth/request-otp")
def auth_request_otp(payload: OtpRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    try:
        with session_scope() as session:
            result, email, otp = request_otp(session, payload.email)
        background_tasks.add_task(_send_otp, email, otp)
        return result
    except (ValueError, RuntimeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/auth/verify-otp")
def auth_verify_otp(payload: OtpVerifyRequest) -> dict[str, Any]:
    try:
        with session_scope() as session:
            return verify_otp(session, payload.email, payload.otp)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/auth/create-password")
def auth_create_password(payload: PasswordCreateRequest) -> dict[str, Any]:
    try:
        with session_scope() as session:
            return create_password(session, payload.email, payload.password)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/auth/account-status")
def auth_account_status(payload: OtpRequest) -> dict[str, Any]:
    try:
        with session_scope() as session:
            return account_status(session, payload.email)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/auth/sign-in")
def auth_sign_in(payload: PasswordLoginRequest) -> dict[str, Any]:
    try:
        with session_scope() as session:
            return sign_in(session, payload.email, payload.password)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/bookings/general-ticket")
def general_ticket(payload: GeneralTicketRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    try:
        with session_scope() as session:
            result, email, ticket = create_general_ticket(
                session, payload.session_token, payload.train_id, payload.train_name,
                payload.boarding_station, payload.destination_station,
                payload.scheduled_departure, payload.scheduled_arrival, payload.journey_duration,
            )
        background_tasks.add_task(_send_ticket_email, email, ticket)
        return result
    except (ValueError, RuntimeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/simulate/tick")
async def simulate_tick() -> dict[str, Any]:
    with session_scope() as session:
        result = await simulator.tick(session)
    await broadcast(result)
    return result


@app.post("/api/simulate/event")
async def inject_event(payload: EventCreate) -> dict[str, Any]:
    with session_scope() as session:
        result = ingest_event(session, payload)
    await broadcast(result)
    return result


@app.post("/api/ingest/operational-event")
async def operational_event(payload: EventCreate) -> dict[str, Any]:
    """Integration endpoint for GPS, signalling, section and dispatch feeds."""
    with session_scope() as session:
        result = ingest_event(session, payload)
    await broadcast(result)
    return result


@app.post("/api/ingest/operational-events")
async def operational_events(payload: EventBatch) -> dict[str, Any]:
    """Batch-friendly ingress for high-volume feed consumers (max 1,000)."""
    if len(payload.events) > 1000:
        raise HTTPException(status_code=422, detail="A batch may contain at most 1,000 events")
    with session_scope() as session:
        results = [ingest_event(session, event) for event in payload.events]
    if results:
        await broadcast(results[-1])
    return {"accepted": len(results), "latest": results[-1] if results else None}


@app.post("/api/what-if")
def what_if(payload: WhatIfRequest) -> dict[str, Any]:
    with session_scope() as session:
        return simulator.what_if(session, payload)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    connections.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        connections.discard(ws)


async def broadcast(payload: dict[str, Any]) -> None:
    for ws in list(connections):
        try:
            await ws.send_json(payload)
        except Exception:
            connections.discard(ws)
