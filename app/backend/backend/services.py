import random
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Thread
from datetime import datetime, timedelta, timezone

import numpy as np
from sqlalchemy.orm import Session

from .ml_model import EtaModel
from .models import TrainEvent, TrainState
from .railradar import LiveTrainResult, railradar
from .schemas import EventCreate, WhatIfRequest
from .operational_feeds import normalize_signal, weather_observation

TRAIN_IDS = [str(train_id) for train_id in range(12603, 12623)] + [str(train_id) for train_id in range(17221, 17251)]
ANDHRA_CORRIDORS = [
    ("Coastal Link", ["Visakhapatnam", "Anakapalle", "Tuni", "Rajahmundry", "Eluru", "Vijayawada"]),
    ("Krishna Intercity", ["Vijayawada", "Tenali", "Bapatla", "Ongole", "Nellore", "Gudur", "Tirupati"]),
    ("Godavari Express", ["Kakinada Town", "Samalkot", "Rajahmundry", "Nidadavolu", "Tadepalligudem", "Eluru", "Vijayawada"]),
    ("Rayalaseema Express", ["Guntur", "Narasaraopet", "Vinukonda", "Markapur Road", "Nandyal", "Kurnool City"]),
    ("Tirumala Passenger", ["Tirupati", "Renigunta", "Gudur", "Nellore", "Ongole", "Vijayawada"]),
    ("Udayagiri Link", ["Nellore", "Kavali", "Ongole", "Bapatla", "Tenali", "Guntur"]),
    ("Vamsadhara Express", ["Srikakulam Road", "Vizianagaram", "Visakhapatnam", "Anakapalle", "Tuni"]),
    ("Kalinga Coast", ["Vizianagaram", "Visakhapatnam", "Rajahmundry", "Eluru", "Vijayawada"]),
    ("Delta Express", ["Machilipatnam", "Gudivada", "Vijayawada", "Tenali", "Guntur"]),
    ("Konaseema Link", ["Amalapuram", "Kakinada Town", "Samalkot", "Rajahmundry", "Vijayawada"]),
    ("Penna Intercity", ["Kadapa", "Rajampet", "Renigunta", "Tirupati"]),
    ("Anantapur Link", ["Anantapur", "Dharmavaram", "Kadiri", "Madanapalle Road", "Tirupati"]),
    ("Kurnool Passenger", ["Kurnool City", "Nandyal", "Dhone", "Gooty", "Anantapur"]),
    ("Chittoor Express", ["Chittoor", "Katpadi", "Renigunta", "Tirupati"]),
    ("Palnadu Express", ["Macherla", "Narasaraopet", "Guntur", "Vijayawada"]),
    ("Bhimavaram Link", ["Bhimavaram", "Narasapur", "Nidadavolu", "Tadepalligudem", "Eluru"]),
    ("East Godavari Passenger", ["Rajahmundry", "Pithapuram", "Samalkot", "Kakinada Town"]),
    ("Prakasam Express", ["Ongole", "Markapur Road", "Vinukonda", "Narasaraopet", "Guntur"]),
    ("Seshachalam Link", ["Tirupati", "Pakala", "Piler", "Madanapalle Road", "Kadapa"]),
    ("North Andhra Link", ["Palasa", "Srikakulam Road", "Vizianagaram", "Visakhapatnam"]),
    ("Amaravati Intercity", ["Vijayawada", "Mangalagiri", "Guntur", "Narasaraopet"]),
    ("West Godavari Link", ["Eluru", "Tadepalligudem", "Nidadavolu", "Rajahmundry"]),
    ("Simhachalam Express", ["Visakhapatnam", "Duvvada", "Anakapalle", "Tuni", "Samalkot"]),
    ("Sri City Passenger", ["Gudur", "Sullurpeta", "Nayudupeta", "Tirupati"]),
    ("Puttaparthi Link", ["Hindupur", "Penukonda", "Dharmavaram", "Puttaparthi", "Kadiri"]),
]
TRAIN_CATALOG = [
    (TRAIN_IDS[index], f"{route[0]} - {route[-1]} {name}", route)
    for index, (name, route) in enumerate(ANDHRA_CORRIDORS)
] + [
    (TRAIN_IDS[index + len(ANDHRA_CORRIDORS)], f"{route[-1]} - {route[0]} {name}", list(reversed(route)))
    for index, (name, route) in enumerate(ANDHRA_CORRIDORS)
]
CATALOG_BY_ID = {train_id: (train_name, route) for train_id, train_name, route in TRAIN_CATALOG}
ALL_STATIONS = sorted({station for _, _, route in TRAIN_CATALOG for station in route})
eta_model = EtaModel()


def _route_for_state(state: TrainState) -> list[str]:
    return CATALOG_BY_ID.get(state.train_id, (state.train_name, [state.current_station, state.next_station]))[1]


def _station_coordinates(station: str) -> tuple[float, float]:
    # Stable demo coordinates keep each simulated station in the Andhra region.
    seed = sum(ord(letter) for letter in station)
    return 13.1 + (seed % 520) / 100, 77.8 + (seed % 610) / 100


def _route_position(route: list[str], current_station: str, next_station: str) -> int:
    if current_station in route:
        return route.index(current_station)
    if next_station in route:
        return max(0, route.index(next_station) - 1)
    return 0


def _historical_delay(session: Session | None, state: TrainState) -> float:
    """Rolling historical-delay feature from persisted operational events."""
    if session is None:
        return state.delay_min
    events = session.query(TrainEvent).filter_by(train_id=state.train_id).order_by(TrainEvent.created_at.desc()).limit(100).all()
    delays = []
    for event in events:
        try:
            value = json.loads(event.payload_json).get("delay_min")
            if value is not None:
                delays.append(float(value))
        except (ValueError, TypeError, json.JSONDecodeError):
            continue
    return sum(delays) / len(delays) if delays else state.delay_min


def _downstream_congestion(session: Session | None, state: TrainState) -> float:
    if session is None:
        return state.downstream_congestion
    peers = session.query(TrainState).filter(TrainState.next_station == state.next_station, TrainState.train_id != state.train_id).all()
    values = [peer.congestion for peer in peers] + [state.downstream_congestion]
    return max(state.downstream_congestion, sum(values) / len(values))


def _eta_minutes(state: TrainState, route: list[str] | None = None, session: Session | None = None, historical_delay: float | None = None, downstream: float | None = None) -> float:
    route = route or _route_for_state(state)
    station_index = _route_position(route, state.current_station, state.next_station)
    distance = 35.0 + ((station_index + len(state.train_id)) % 4) * 18.0
    return eta_model.predict(
        speed_kmph=state.speed_kmph,
        delay_min=state.delay_min,
        congestion=state.congestion,
        weather=state.weather,
        distance_km=distance,
        hour=datetime.now(timezone.utc).hour,
        signal_restriction=state.signal_restriction,
        sectional_runtime_factor=state.sectional_runtime_factor,
        downstream_congestion=downstream if downstream is not None else _downstream_congestion(session, state),
        historical_delay_min=historical_delay if historical_delay is not None else _historical_delay(session, state),
        route_zone=state.route_zone,
        train_class=state.train_class,
    )


def _prediction_payload(state: TrainState, route: list[str] | None = None, session: Session | None = None) -> dict:
    route = route or _route_for_state(state)
    # Query history/network pressure once per train prediction, then reuse it
    # for every remaining station forecast.
    historical_delay = _historical_delay(session, state)
    downstream = _downstream_congestion(session, state)
    eta_min = _eta_minutes(state, route, session, historical_delay, downstream)
    now = datetime.now(timezone.utc)
    stopped = state.speed_kmph <= 1
    station_index = _route_position(route, state.current_station, state.next_station)
    remaining = route[station_index + 1:]
    station_forecasts = []
    cumulative = 0.0
    # One XGBoost evaluation represents the current operational condition. A
    # long train can have 100+ stops; evaluating the model for every single
    # stop made live tracking take seconds. Derive each later leg from this
    # model-based running rate instead, so the API remains responsive.
    first_leg_distance = 35.0 + ((station_index + len(state.train_id)) % 4) * 18.0
    model_minutes_per_km = eta_min / max(first_leg_distance, 1.0)
    for offset, station in enumerate(remaining):
        leg_distance = 35.0 + ((station_index + offset + len(state.train_id)) % 4) * 18.0
        leg_eta = max(2.0, leg_distance * model_minutes_per_km)
        cumulative += leg_eta
        station_forecasts.append({"station": station, "etaMinutes": round(cumulative, 1), "arrivalAt": (now + timedelta(minutes=cumulative)).isoformat()})
    destination_minutes = cumulative or eta_min
    destination_uncertainty = max(8.0, destination_minutes * 0.08)
    return {
        "trainId": state.train_id,
        "trainName": state.train_name,
        "originStation": route[0],
        "destinationStation": route[-1],
        "routeStations": route,
        "routeStationsText": "|".join(route),
        "currentStation": state.current_station,
        "nextStation": state.next_station,
        "section": state.section,
        "latitude": state.latitude,
        "longitude": state.longitude,
        "speedKmph": state.speed_kmph,
        "operationalStatus": "Stopped at station" if stopped else "En route",
        "isStopped": stopped,
        "dwellRemainingMinutes": 3 if stopped else 0,
        "delayMin": round(state.delay_min, 1),
        "weather": state.weather,
        "congestion": round(state.congestion, 2),
        "downstreamCongestion": round(downstream, 2),
        "signalRestriction": round(state.signal_restriction, 2),
        "sectionalRuntimeFactor": round(state.sectional_runtime_factor, 2),
        "historicalDelayMinutes": round(historical_delay, 1),
        "routeZone": state.route_zone,
        "trainClass": state.train_class,
        "predictedEtaMinutes": round(eta_min, 1),
        "predictedArrivalAtNextStation": (now + timedelta(minutes=eta_min)).isoformat(),
        "destinationEta": (now + timedelta(minutes=destination_minutes)).isoformat(),
        "destinationEtaRange": [
            (now + timedelta(minutes=max(0, destination_minutes - destination_uncertainty))).isoformat(),
            (now + timedelta(minutes=destination_minutes + destination_uncertainty)).isoformat(),
        ],
        "confidence": round(max(0.5, 0.96 - state.congestion * 0.2 - min(state.delay_min / 120, 0.25)), 2),
        "etaRangeMinutes": [round(max(eta_min - 6, 3), 1), round(eta_min + 9, 1)],
        "stationForecasts": station_forecasts,
        "model": eta_model.metadata,
        "updatedAt": now.isoformat(),
    }


def seed_fleet(session: Session) -> None:
    existing = {row.train_id for row in session.query(TrainState).all()}
    for index, (train_id, train_name, route) in enumerate(TRAIN_CATALOG):
        if train_id in existing:
            state = session.query(TrainState).filter_by(train_id=train_id).one()
            state.train_name = train_name
            state.destination_station = route[-1]
            if state.current_station not in route or state.next_station not in route or route.index(state.next_station) != route.index(state.current_station) + 1:
                station_index = index % (len(route) - 1)
                state.current_station = route[station_index]
                state.next_station = route[station_index + 1]
                state.section = f"{state.current_station} → {state.next_station}"
                state.latitude, state.longitude = _station_coordinates(state.current_station)
            continue
        station_index = index % (len(route) - 1)
        latitude, longitude = _station_coordinates(route[station_index])
        session.add(TrainState(
            train_id=train_id,
            train_name=train_name,
            current_station=route[station_index],
            next_station=route[station_index + 1],
            latitude=latitude,
            longitude=longitude,
            speed_kmph=58.0 + (index * 7) % 30,
            delay_min=float((index * 3) % 15),
            section=f"{route[station_index]} → {route[station_index + 1]}",
            weather=["Clear", "Cloudy", "Rain"][index % 3],
            congestion=round(0.12 + (index % 7) * 0.08, 2),
            signal_restriction=0.0,
            sectional_runtime_factor=round(0.92 + (index % 5) * 0.06, 2),
            downstream_congestion=round(0.08 + (index % 6) * 0.09, 2),
            route_zone="South Central" if index % 3 else "Southern",
            train_class="Superfast" if index % 4 == 0 else "Express",
            destination_station=route[-1],
            updated_at=datetime.utcnow(),
        ))
    session.flush()


def seed_demo(session: Session) -> TrainState:
    seed_fleet(session)
    return session.query(TrainState).filter_by(train_id="12603").one()


def get_or_seed(session: Session) -> TrainState:
    seed_fleet(session)
    return session.query(TrainState).filter_by(train_id="12603").one()


def get_fleet_predictions(session: Session) -> list[dict]:
    seed_fleet(session)
    return [_prediction_payload(state, session=session) for state in session.query(TrainState).order_by(TrainState.train_id).all()]


def get_real_train_directory(query: str = "", page: int = 1, page_size: int = 50) -> dict:
    """Search the cached RailRadar directory without making passengers wait."""
    result = railradar.cached_train_directory()
    railradar.refresh_train_directory_async()
    if result is None:
        return {"trains": [], "total": 0, "page": page, "pageSize": page_size, "dataSource": "warming", "error": "Train directory is loading. Please search again in a moment."}
    if not isinstance(result.data, dict):
        return {"trains": [], "total": 0, "page": page, "pageSize": page_size, "dataSource": result.source, "error": result.error}

    needle = query.strip().lower()
    trains = [
        {"trainId": str(number), "trainName": str(name)}
        for number, name in result.data.items()
        if not needle or needle in str(number).lower() or needle in str(name).lower()
    ]
    trains.sort(key=lambda train: train["trainId"])
    page = max(page, 1)
    page_size = max(10, min(page_size, 100))
    start = (page - 1) * page_size
    return {
        "trains": trains[start:start + page_size],
        "total": len(trains),
        "page": page,
        "pageSize": page_size,
        "dataSource": result.source,
        "error": result.error,
    }


def get_live_map_snapshot(limit: int = 10000) -> dict:
    """Normalize cached RailRadar positions without delaying dashboard updates."""
    result = railradar.cached_live_map()
    railradar.refresh_live_map_async()
    if result is None:
        return {"trains": [], "total": 0, "dataSource": "warming", "error": "Live network feed is refreshing."}
    if not isinstance(result.data, list):
        return {"trains": [], "total": 0, "dataSource": result.source, "error": result.error}
    def number(value: object) -> float:
        try:
            return float(value or 0.0)
        except (TypeError, ValueError):
            return 0.0

    trains = []
    for train in result.data[:max(1, min(limit, 10000))]:
        latitude, longitude = train.get("current_lat"), train.get("current_lng")
        if latitude is None or longitude is None:
            continue
        speed_kmph = number(train.get("speed_kmh") or train.get("speedKmh") or train.get("speed"))
        delay_min = max(0.0, number(train.get("delay_minutes") or train.get("delayMinutes") or train.get("delay")))
        congestion = min(1.0, delay_min / 60.0)
        # The map feed supplies live position but not a full timetable for every
        # service. Estimate its next-station ETA with the trained model.
        estimated_eta = eta_model.predict(
            speed_kmph=max(speed_kmph, 15.0), delay_min=delay_min,
            congestion=congestion, weather="Clear", distance_km=45.0,
            hour=datetime.now(timezone.utc).hour,
        )
        trains.append({
            "trainId": str(train.get("train_number", "")),
            "trainName": train.get("train_name") or "Unknown train",
            "originStation": train.get("origin_station_name") or train.get("origin") or "Route origin pending",
            "destinationStation": train.get("destination_station_name") or train.get("destination") or "Route destination pending",
            "currentStation": train.get("current_station_name") or train.get("current_station") or "Unknown location",
            "nextStation": train.get("next_station_name") or train.get("next_station") or "Unknown",
            "latitude": float(latitude),
            "longitude": float(longitude),
            "speedKmph": round(speed_kmph, 1),
            "delayMin": round(delay_min, 1),
            "congestion": round(congestion, 2),
            "weather": "Clear",
            "isStopped": speed_kmph <= 1,
            "predictedEtaMinutes": round(estimated_eta, 1),
            "confidence": round(max(0.5, 0.88 - congestion * 0.2), 2),
            "operationalStatus": "Live RailRadar position",
            "source": "railradar",
        })
    return {"trains": trains, "total": len(trains), "dataSource": result.source, "error": result.error}


def search_stations(query: str) -> dict:
    needle = query.strip().lower()
    local_matches = [
        {"code": "".join(part[0] for part in station.upper().split())[:4], "name": station, "city": station, "isActive": True}
        for station in ALL_STATIONS
        if needle and needle in station.lower()
    ]
    # Respond instantly for stations represented in the prototype network. This
    # keeps autocomplete usable while the external provider warms its cache.
    if local_matches:
        Thread(target=railradar.search_stations, args=(query,), daemon=True).start()
        return {"stations": local_matches[:10], "dataSource": "local-index", "error": None}
    result = railradar.search_stations(query)
    stations = result.data if isinstance(result.data, list) else []
    return {"stations": stations, "dataSource": result.source, "error": result.error}


def _station_code(value: str) -> tuple[str | None, str]:
    cleaned = value.strip()
    if not cleaned:
        return None, ""
    result = railradar.search_stations(cleaned)
    stations = result.data if isinstance(result.data, list) else []
    exact = next((station for station in stations if station.get("code", "").lower() == cleaned.lower() or station.get("name", "").lower() == cleaned.lower()), None)
    station = exact or (stations[0] if stations else None)
    return (station or {}).get("code"), result.error or ""


def search_trains_between(origin: str, destination: str, live: bool = True) -> dict:
    # Resolve both station names concurrently; provider lookups can otherwise
    # make the passenger wait once for boarding and again for destination.
    with ThreadPoolExecutor(max_workers=2) as executor:
        origin_future = executor.submit(_station_code, origin)
        destination_future = executor.submit(_station_code, destination)
        origin_code, origin_error = origin_future.result()
        destination_code, destination_error = destination_future.result()
    if not origin_code or not destination_code:
        return {"trains": [], "total": 0, "dataSource": "railradar", "error": origin_error or destination_error or "Choose valid departure and arrival stations."}
    result = railradar.trains_between(origin_code, destination_code, live=live)
    payload = result.data if isinstance(result.data, dict) else {}
    trains = []
    departed_count = 0
    for item in payload.get("trains", []):
        train = item.get("train") or {}
        live = item.get("live") or {}
        live_status = live.get("type") or "scheduled"
        # A passenger can still board a scheduled, upcoming, or at-station train.
        # Do not offer a service once it has already departed the chosen origin today.
        if live and live_status.lower() in {"departed", "passed"}:
            departed_count += 1
            continue
        trains.append({
            "trainId": str(train.get("number", "")),
            "trainName": train.get("name") or "Unknown train",
            "originStation": (payload.get("from") or {}).get("name") or origin,
            "destinationStation": (payload.get("to") or {}).get("name") or destination,
            "departure": (item.get("from") or {}).get("departure"),
            "arrival": (item.get("to") or {}).get("arrival"),
            "distanceKm": item.get("distance"),
            "durationMinutes": item.get("duration"),
            "halts": item.get("totalHaltsBetween"),
            "platform": live.get("platform"),
            "liveStatus": live_status,
            "delayMin": live.get("delayMinutes"),
        })
    return {
        "trains": trains,
        "total": len(trains),
        "origin": payload.get("from") or {"code": origin_code, "name": origin},
        "destination": payload.get("to") or {"code": destination_code, "name": destination},
        "dataSource": result.source,
        "error": result.error,
        "departedExcluded": departed_count,
        "verificationPending": not live,
    }


def compute_prediction(session: Session, train_id: str) -> dict:
    state = session.query(TrainState).filter_by(train_id=train_id).one_or_none()
    if state is None:
        # Give a newly selected provider train an immediate, correctly labelled
        # prediction while its remote live route is warming in the cache.
        sample = get_or_seed(session)
        state = TrainState(train_id=train_id, train_name=f"Train {train_id}", current_station=sample.current_station, next_station=sample.next_station, latitude=sample.latitude, longitude=sample.longitude, speed_kmph=sample.speed_kmph, delay_min=sample.delay_min, section=sample.section, weather=sample.weather, congestion=sample.congestion, destination_station=sample.destination_station, signal_restriction=sample.signal_restriction, sectional_runtime_factor=sample.sectional_runtime_factor, downstream_congestion=sample.downstream_congestion, route_zone=sample.route_zone, train_class=sample.train_class)
    return _prediction_payload(state, session=session)


def refresh_live_prediction(session: Session, train_id: str) -> dict:
    state = session.query(TrainState).filter_by(train_id=train_id).one_or_none()
    if state is None:
        # Match the selected train ID immediately; do not block the UI on an
        # external provider that can take several seconds to respond.
        sample = get_or_seed(session)
        state = TrainState(train_id=train_id, train_name=f"Train {train_id}", current_station=sample.current_station, next_station=sample.next_station, latitude=sample.latitude, longitude=sample.longitude, speed_kmph=sample.speed_kmph, delay_min=sample.delay_min, section=sample.section, weather=sample.weather, congestion=sample.congestion, destination_station=sample.destination_station, signal_restriction=sample.signal_restriction, sectional_runtime_factor=sample.sectional_runtime_factor, downstream_congestion=sample.downstream_congestion, route_zone=sample.route_zone, train_class=sample.train_class)
    live = railradar.cached_live_train(train_id) or LiveTrainResult(None, "warming", "Live provider is refreshing")
    railradar.refresh_live_train_async(train_id)
    live_route: list[str] | None = None
    route: list[dict] = []
    route_timeline: list[dict] = []
    journey_status: str | None = None
    last_updated_at: str | None = None
    if live.data:
        payload = live.data
        route = payload.get("route") or []
        live_route = [stop.get("stationName") for stop in route if stop.get("stationName")]
        journey_status = payload.get("status")
        last_updated_at = payload.get("lastUpdatedAt")
        route_timeline = [
            {
                "sequence": stop.get("sequence"),
                "station": stop.get("stationName") or stop.get("stationCode") or "Unknown station",
                "stationCode": stop.get("stationCode"),
                "isHalt": bool(stop.get("isHalt")),
                "distanceKm": stop.get("distance"),
                "scheduledArrival": stop.get("scheduledArrival"),
                "scheduledDeparture": stop.get("scheduledDeparture"),
                "actualArrival": stop.get("actualArrival"),
                "actualDeparture": stop.get("actualDeparture"),
                "platform": stop.get("platform"),
                "status": stop.get("status") or "scheduled",
                "arrivalDelayMinutes": stop.get("delayArrival"),
                "departureDelayMinutes": stop.get("delayDeparture"),
            }
            for stop in route
        ]
        location = payload.get("currentLocation") or {}
        current_code = location.get("stationCode")
        current_stop = next((stop for stop in route if stop.get("stationCode") == current_code), None) or {}
        next_stop = payload.get("nextHalt") or {}
        train = payload.get("train") or {}
        state.train_name = train.get("name") or payload.get("trainName") or state.train_name
        state.current_station = current_stop.get("stationName") or current_code or state.current_station
        if journey_status == "completed":
            state.next_station = state.current_station
            state.section = f"Arrived at {state.current_station}"
            state.speed_kmph = 0.0
        else:
            state.next_station = next_stop.get("stationName") or next_stop.get("stationCode") or state.next_station
            state.section = f"{state.current_station} → {state.next_station}"
            state.speed_kmph = float(location.get("speedKmh") or state.speed_kmph)
        state.delay_min = max(0.0, float(payload.get("delayMinutes") or 0.0))
        state.destination_station = (train.get("destination") or {}).get("name") or (live_route[-1] if live_route else state.destination_station)
        if current_stop.get("lat") is not None and current_stop.get("lng") is not None:
            state.latitude = float(current_stop["lat"])
            state.longitude = float(current_stop["lng"])
        state.updated_at = datetime.utcnow()
        session.flush()
    # Live weather is refreshed only for the selected live service; the cache
    # prevents repeated public-weather requests during frequent ETA polling.
    weather = weather_observation(state.latitude, state.longitude, state.weather) if live.data else {"condition": state.weather, "source": "simulator", "isLive": False}
    state.weather = str(weather["condition"])
    prediction = _prediction_payload(state, live_route, session)
    prediction["dataSource"] = live.source
    prediction["weatherObservation"] = weather
    prediction["liveDataError"] = live.error
    prediction["journeyStatus"] = journey_status
    prediction["lastUpdatedAt"] = last_updated_at
    prediction["routeTimeline"] = route_timeline
    # The route's final timetable is the correct baseline for a passenger ETA.
    # Do not multiply the current-section delay across every later stop: that
    # can turn a 16-minute delay into several hours on a long journey.
    if route:
        final_schedule = route[-1].get("scheduledArrival")
        if final_schedule:
            try:
                scheduled_destination = datetime.fromisoformat(final_schedule)
                if scheduled_destination.tzinfo is None:
                    scheduled_destination = scheduled_destination.replace(tzinfo=timezone.utc)
                baseline_next_eta = eta_model.predict(
                    speed_kmph=state.speed_kmph, delay_min=0.0, congestion=state.congestion,
                    weather=state.weather, distance_km=35.0, hour=datetime.now(timezone.utc).hour,
                    signal_restriction=state.signal_restriction,
                    sectional_runtime_factor=state.sectional_runtime_factor,
                    downstream_congestion=_downstream_congestion(session, state),
                    historical_delay_min=_historical_delay(session, state),
                    route_zone=state.route_zone, train_class=state.train_class,
                )
                model_delay = max(0.0, float(prediction["predictedEtaMinutes"]) - baseline_next_eta)
                live_delay = max(state.delay_min, model_delay)
                expected_destination = scheduled_destination + timedelta(minutes=live_delay)
                uncertainty = max(7.0, min(30.0, 7.0 + live_delay * 0.18 + state.congestion * 8))
                prediction.update({
                    "destinationEta": expected_destination.isoformat(),
                    "destinationEtaRange": [
                        (expected_destination - timedelta(minutes=uncertainty)).isoformat(),
                        (expected_destination + timedelta(minutes=uncertainty)).isoformat(),
                    ],
                    "destinationDelayMinutes": round(live_delay, 1),
                    "scheduledDestinationArrival": scheduled_destination.isoformat(),
                })
            except (TypeError, ValueError):
                pass
    if journey_status == "completed":
        terminal_stop = route_timeline[-1] if route_timeline else {}
        scheduled_arrival = terminal_stop.get("scheduledArrival")
        actual_arrival = terminal_stop.get("actualArrival")
        arrival_performance = {"label": "Arrived", "minutes": 0}
        if scheduled_arrival and actual_arrival:
            try:
                difference = round((datetime.fromisoformat(actual_arrival) - datetime.fromisoformat(scheduled_arrival)).total_seconds() / 60)
                if difference < 0:
                    arrival_performance = {"label": f"Arrived {abs(difference)} min early", "minutes": difference}
                elif difference > 0:
                    arrival_performance = {"label": f"Arrived {difference} min late", "minutes": difference}
                else:
                    arrival_performance = {"label": "Arrived on time", "minutes": 0}
            except ValueError:
                pass
        # RailRadar may retain a stale nextHalt after the final arrival.
        prediction.update({
            "nextStation": "Destination reached",
            "section": f"Arrived at {state.current_station}",
            "speedKmph": 0.0,
            "operationalStatus": "Journey completed",
            "isStopped": True,
            "dwellRemainingMinutes": 0,
            "predictedEtaMinutes": 0.0,
            "etaRangeMinutes": [0.0, 0.0],
            "stationForecasts": [],
            "arrivalPerformance": arrival_performance,
        })
    elif journey_status == "not-started":
        origin_stop = route_timeline[0] if route_timeline else {}
        origin_station = origin_stop.get("station") or state.current_station
        # A not-started service can include its first halt as nextHalt. It is not
        # yet the next live movement, so expose the origin and departure state.
        prediction.update({
            "currentStation": origin_station,
            "nextStation": origin_station,
            "section": f"Awaiting departure from {origin_station}",
            "speedKmph": 0.0,
            "operationalStatus": "Not started - awaiting scheduled departure",
            "isStopped": False,
            "dwellRemainingMinutes": 0,
            "scheduledDeparture": origin_stop.get("scheduledDeparture"),
        })
    return prediction


def ingest_event(session: Session, payload: EventCreate) -> dict:
    state = session.query(TrainState).filter_by(train_id=payload.train_id).one_or_none() or get_or_seed(session)
    for field in ["latitude", "longitude", "speed_kmph", "delay_min", "weather", "congestion", "signal_restriction", "sectional_runtime_factor", "downstream_congestion", "route_zone", "train_class"]:
        value = getattr(payload, field)
        if value is not None:
            setattr(state, field, value)
    if payload.signal_aspect is not None:
        state.signal_restriction = normalize_signal(payload.signal_aspect, payload.signal_restriction)
    state.updated_at = datetime.utcnow()
    session.add(TrainEvent(train_id=payload.train_id, event_type=payload.event_type, payload_json=payload.model_dump_json()))
    return {"type": "event", "prediction": _prediction_payload(state, session=session)}


def get_dashboard_snapshot(session: Session, live_network: dict | None = None) -> dict:
    state = get_or_seed(session)
    prediction = _prediction_payload(state, session=session)
    history = [{"time": (datetime.now(timezone.utc) - timedelta(minutes=i * 4)).isoformat(), "eta": round(prediction["predictedEtaMinutes"] + np.sin(i / 2) * 3 + i, 1), "delay": round(max(0, state.delay_min + np.cos(i / 2) * 2), 1), "speed": round(max(0, state.speed_kmph + np.sin(i) * 4), 1)} for i in range(12)]
    # The caller fetches this before opening a database session. Network calls
    # must never hold a MySQL connection while RailRadar responds.
    live_network = live_network or get_live_map_snapshot(limit=10000)
    live_fleet = live_network["trains"] if live_network["dataSource"] == "railradar" else []
    fleet = live_fleet or get_fleet_predictions(session)
    is_live_network = bool(live_fleet)
    alerts = [{
        "level": "info",
        "message": f"LIVE RAILRADAR — {len(fleet)} running trains reported in the latest network snapshot"
        if is_live_network else "DEMO MODE — Simulated operational data",
    }]
    if state.delay_min >= 10:
        alerts.append({"level": "critical", "message": f"Delay threshold exceeded by {state.delay_min:.0f} min"})
    else:
        alerts.append({"level": "warning", "message": f"Current delay detected: {state.delay_min:.0f} min"})
    if state.weather in {"Rain", "Heavy Rain", "Fog"}:
        alerts.append({"level": "warning", "message": f"Weather impact: {state.weather} may reduce section speed"})
    return {
        "train": prediction,
        "fleet": fleet,
        "fleetCount": len(fleet),
        "fleetDataSource": "railradar" if is_live_network else "simulator",
        "history": history,
        "alerts": alerts,
        "stations": ALL_STATIONS,
        "route": [{"name": name, "latitude": _station_coordinates(name)[0], "longitude": _station_coordinates(name)[1], "status": "passed" if index < _route_for_state(state).index(state.current_station) else "upcoming" if index > _route_for_state(state).index(state.current_station) else "current"} for index, name in enumerate(_route_for_state(state))],
        "model": prediction["model"],
    }


class Simulator:
    async def ensure_seeded(self) -> None:
        return None

    async def tick(self, session: Session) -> dict:
        seed_fleet(session)
        states = session.query(TrainState).all()
        for state in states:
            if state.speed_kmph <= 1:
                state.speed_kmph = random.uniform(48, 72)
            elif random.random() < 0.18:
                state.speed_kmph = 0.0
            else:
                state.speed_kmph = max(42.0, min(95.0, state.speed_kmph + random.uniform(-4, 5)))
            route = _route_for_state(state)
            station_index = route.index(state.current_station) if state.current_station in route else 0
            if state.speed_kmph > 1 and random.random() < 0.35:
                station_index = min(len(route) - 2, station_index + 1)
            latitude, longitude = _station_coordinates(route[station_index])
            state.latitude = latitude + random.uniform(-0.006, 0.006)
            state.longitude = longitude + random.uniform(-0.006, 0.006)
            # The demo ticks every second, so constrain drift to avoid artificial delay inflation.
            state.delay_min = min(45.0, max(0.0, state.delay_min + random.uniform(-0.5, 0.35)))
            state.congestion = min(0.95, max(0.05, state.congestion + random.uniform(-0.04, 0.05)))
            state.weather = random.choice(["Clear", "Cloudy", "Rain"])
            state.current_station = route[station_index]
            state.next_station = route[station_index + 1]
            state.section = f"{state.current_station} → {state.next_station}"
            state.updated_at = datetime.utcnow()
        featured = next(state for state in states if state.train_id == "12603")
        return {"type": "tick", "prediction": _prediction_payload(featured, session=session), "fleet": [_prediction_payload(state, session=session) for state in states], "fleetCount": len(states)}

    def what_if(self, session: Session, payload: WhatIfRequest) -> dict:
        state = session.query(TrainState).filter_by(train_id=payload.train_id).one_or_none() or get_or_seed(session)
        temp = TrainState(**{c.name: getattr(state, c.name) for c in state.__table__.columns})
        for field in ["speed_kmph", "delay_min", "congestion", "weather", "signal_restriction", "sectional_runtime_factor", "downstream_congestion"]:
            value = getattr(payload, field)
            if value is not None:
                setattr(temp, field, value)
        return {"scenario": _prediction_payload(temp, session=session)}
