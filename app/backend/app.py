import asyncio
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db, session_scope
from .schemas import EventCreate, WhatIfRequest
from .services import Simulator, compute_prediction, get_dashboard_snapshot, ingest_event

app = FastAPI(title="RailETA AI API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

simulator = Simulator()
connections: set[WebSocket] = set()


@app.on_event("startup")
async def startup() -> None:
    init_db()
    await simulator.ensure_seeded()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "mode": "demo"}


@app.get("/api/dashboard")
def dashboard() -> dict[str, Any]:
    with session_scope() as session:
        return get_dashboard_snapshot(session)


@app.get("/api/trains/{train_id}")
def train_detail(train_id: str) -> dict[str, Any]:
    with session_scope() as session:
        return compute_prediction(session, train_id)


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
    stale = []
    for ws in connections:
        try:
            await ws.send_json(payload)
        except Exception:
            stale.append(ws)
    for ws in stale:
        connections.discard(ws)


@app.on_event("startup")
async def kick_off_loop() -> None:
    async def loop() -> None:
        while True:
            await asyncio.sleep(4)
            with session_scope() as session:
                payload = await simulator.tick(session)
            await broadcast(payload)

    asyncio.create_task(loop())
