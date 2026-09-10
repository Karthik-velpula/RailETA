import math
import re
from typing import Any

from sqlalchemy.orm import Session

from .operational_feeds import weather_observation
from .services import ALL_STATIONS, _station_coordinates, get_fleet_predictions, refresh_live_prediction, search_trains_between

NO_DATA = "I don't have current data for that request. Try a train number such as 17243 or ask about active alerts."


def _train_number(message: str) -> str | None:
    match = re.search(r"\b\d{4,6}\b", message)
    return match.group(0) if match else None


def _format_minutes(value: Any) -> str:
    try:
        minutes = max(0, round(float(value)))
    except (TypeError, ValueError):
        return "unavailable"
    hours, remainder = divmod(minutes, 60)
    return f"{hours} hr {remainder} min" if hours else f"{remainder} min"


def answer(session: Session, message: str, latitude: float | None = None, longitude: float | None = None) -> dict[str, Any]:
    """Produce a constrained answer from RailETA data only; never infer missing facts."""
    question = message.strip()
    if not question:
        return {"answer": "Ask about live status, ETA, delays, weather, route, platform, booking, station maps, train search, or network alerts.", "sources": []}

    lowered = question.lower()
    if re.fullmatch(r"(?:hi|hello|hey|good morning|good afternoon|good evening|namaste)[!. ]*", lowered):
        return {"answer": "Hello! I can help with live train status, AI ETA, delays, weather, routes, platforms, booking, nearby stations, emergency contacts, and network alerts. Try asking “Where is train 17243?”", "sources": []}
    train_id = _train_number(question)
    if any(word in lowered for word in ("nearby station", "nearest station", "stations near", "closest station")):
        if latitude is None or longitude is None:
            # Location permission is optional: a named station/city is a safe
            # fallback when the browser blocks geolocation.
            named_station = next((station for station in ALL_STATIONS if station.lower() in lowered and len(station) >= 4), None)
            if named_station:
                latitude, longitude = _station_coordinates(named_station)
            else:
                return {"answer": "I can find nearby railway stations. Please allow location access, or ask “nearby stations in Guntur” with your city, area, or current station name.", "sources": []}
        distances = []
        for station in ALL_STATIONS:
            station_lat, station_lon = _station_coordinates(station)
            d_lat = math.radians(station_lat - latitude)
            d_lon = math.radians(station_lon - longitude)
            a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(latitude)) * math.cos(math.radians(station_lat)) * math.sin(d_lon / 2) ** 2
            distance_km = 6371 * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))
            distances.append((distance_km, station))
        nearest = sorted(distances)[:5]
        places = ", ".join(f"{station} ({distance:.1f} km)" for distance, station in nearest)
        links = " ".join(f"[{station}](https://www.google.com/maps/search/?api=1&query={station.replace(' ', '+')}+railway+station)" for _, station in nearest[:3])
        return {"answer": f"Nearby railway stations: {places}. Maps: {links}", "sources": ["RailETA station directory"]}
    if any(word in lowered for word in ("platform ticket", "platform price", "platform fee")):
        return {"answer": "The prototype platform-ticket price is ₹20 per passenger. It is separate from the train fare and is shown during booking.", "sources": ["RailETA booking policy"]}

    # Route search questions such as “trains from Guntur to Rayagada”.
    route_match = re.search(r"(?:from|between)\s+([a-z][a-z .'-]+?)\s+(?:to|and)\s+([a-z][a-z .'-]+)", lowered)
    if route_match and any(word in lowered for word in ("train", "service", "journey", "route")):
        result = search_trains_between(route_match.group(1).strip(), route_match.group(2).strip(), live=True)
        trains = result.get("trains") or []
        if not trains:
            return {"answer": f"I couldn't find a current service from {route_match.group(1).title()} to {route_match.group(2).title()}.", "sources": []}
        names = ", ".join(f"{item.get('trainId')} · {item.get('trainName')}" for item in trains[:5])
        return {"answer": f"I found {len(trains)} service(s) from {route_match.group(1).title()} to {route_match.group(2).title()}: {names}.", "sources": ["RailETA train directory"]}
    if train_id:
        train = refresh_live_prediction(session, train_id)
        if not train or not train.get("trainId"):
            return {"answer": NO_DATA, "sources": []}
        name = train.get("trainName") or "train"
        if any(word in lowered for word in ("where", "location", "running", "current")):
            location = train.get("currentStation") or train.get("section")
            return {"answer": f"{train_id} · {name} is currently at {location or 'an unreported location'}, travelling at {round(float(train.get('speedKmph') or 0))} km/h, with {round(float(train.get('delayMin') or 0))} min delay.", "sources": []}
        if "platform" in lowered:
            stop = next((item for item in train.get("routeTimeline") or [] if item.get("station") == train.get("nextStation")), {})
            return {"answer": f"{train.get('nextStation') or 'Next station'} platform: {stop.get('platform')}." if stop.get("platform") else f"Platform information for {train.get('nextStation') or 'the next station'} is not available in the live feed.", "sources": []}
        if any(word in lowered for word in ("eta", "arrival", "reach", "when")):
            next_station = train.get("nextStation")
            eta = train.get("predictedEtaMinutes")
            if not next_station or eta is None:
                return {"answer": NO_DATA, "sources": []}
            if "destination" in lowered or "final" in lowered:
                destination_eta = train.get("destinationEta") or train.get("predictedArrivalAtNextStation")
                forecasts = train.get("stationForecasts") or []
                forecast_text = ", ".join(f"{item.get('station')}: {_format_minutes(item.get('etaMinutes'))}" for item in forecasts[:5])
                return {"answer": f"{train_id} destination ETA: {destination_eta or 'unavailable'} (confidence {round(float(train.get('confidence', 0)) * 100)}%). Upcoming station ETAs: {forecast_text or 'unavailable'}.", "sources": []}
            return {"answer": f"{train_id} is expected at {next_station} in about {_format_minutes(eta)}. Prediction confidence: {round(float(train.get('confidence', 0)) * 100)}%.", "sources": []}
        if any(word in lowered for word in ("why", "cause", "reason", "explain")) and any(word in lowered for word in ("delay", "late", "eta")):
            causes = [("weather", train.get("weather")), ("congestion", train.get("congestion")), ("signal", train.get("signalRestriction")), ("station halt", train.get("dwellRemainingMinutes"))]
            details = ", ".join(f"{label}: {value}" for label, value in causes if value not in (None, 0, 0.0, "Clear"))
            return {"answer": f"{train_id} delay factors: {details or 'no additional operational factor is currently reported'}. Current delay: {_format_minutes(train.get('delayMin'))}.", "sources": ["RailETA operational inputs"]}
        if "delay" in lowered or "late" in lowered:
            delay = train.get("delayMin")
            if delay is None:
                return {"answer": NO_DATA, "sources": []}
            delay_text = "on time" if float(delay) == 0 else f"delayed by {_format_minutes(delay)}"
            return {"answer": f"{train_id} · {name} is currently {delay_text}.", "sources": []}
        if "next" in lowered or "station" in lowered:
            next_station = train.get("nextStation")
            if any(word in lowered for word in ("platform", "platform number")):
                stop = next((item for item in train.get("routeTimeline") or [] if item.get("station") == next_station), {})
                return {"answer": f"{next_station} platform: {stop.get('platform')}." if stop.get("platform") else f"Platform information for {next_station} is not available in the live feed.", "sources": []}
            if any(word in lowered for word in ("map", "navigate", "directions")):
                station = next_station or train.get("currentStation")
                return {"answer": f"Open {station} in Google Maps: https://www.google.com/maps/search/?api=1&query={station.replace(' ', '+')} railway station", "sources": []}
            return {"answer": f"The next reported station for {train_id} is {next_station}." if next_station else NO_DATA, "sources": []}
        if any(word in lowered for word in ("weather", "rain", "temperature", "forecast")):
            weather = train.get("weatherObservation") or weather_observation(float(train.get("latitude") or 20), float(train.get("longitude") or 78), train.get("weather") or "Clear")
            return {"answer": f"Weather near {train.get('currentStation') or 'the train'}: {weather.get('condition', 'unavailable')} ({'live' if weather.get('isLive') else 'fallback'} observation).", "sources": [str(weather.get("source") or "Weather feed")]}
        if any(word in lowered for word in ("route", "stops", "stations", "intermediate")):
            stops = train.get("routeStations") or [item.get("station") for item in train.get("routeTimeline") or [] if item.get("station")]
            return {"answer": f"Route for {train_id}: {' → '.join(stops)}." if stops else NO_DATA, "sources": []}
        if any(word in lowered for word in ("alert", "cancel", "change", "route")):
            error = train.get("liveDataError")
            return {"answer": f"Live alert for {train_id}: {error}." if error else f"No cancellation or route-change alert is currently reported for {train_id}.", "sources": []}
        return {"answer": f"{train_id} · {name}: current location {train.get('currentStation') or 'unavailable'}, next station {train.get('nextStation') or 'unavailable'}, speed {round(float(train.get('speedKmph') or 0))} km/h, and predicted next-station ETA {_format_minutes(train.get('predictedEtaMinutes'))}.", "sources": []}

    if any(word in lowered for word in ("book", "booking", "ticket status", "journey details")):
        return {"answer": "Use Passenger view to book a general ticket. The prototype booking flow includes train selection, boarding and destination stations, journey details, ticket status, and a ₹20 platform-ticket price.", "sources": ["RailETA passenger booking"]}

    station_match = re.search(r"(?:map|navigate|directions|location)\s+(?:to|for)?\s*([a-z][a-z .'-]{2,})", lowered)
    station_match = station_match or re.search(r"(?:open|show)\s+([a-z][a-z .'-]{2,}?)\s+(?:in|on)\s+maps?", lowered)
    if station_match and not train_id:
        station = station_match.group(1).strip().title()
        return {"answer": f"Open {station} railway station in Google Maps: https://www.google.com/maps/search/?api=1&query={station.replace(' ', '+')}+railway+station", "sources": []}

    if any(word in lowered for word in ("alert", "critical", "delay", "network", "fleet", "congestion", "control room")):
        fleet = get_fleet_predictions(session)
        if not fleet:
            return {"answer": NO_DATA, "sources": []}
        delayed = [train for train in fleet if float(train.get("delayMin") or 0) > 0]
        critical = [train for train in fleet if float(train.get("delayMin") or 0) >= 30]
        average = sum(float(train.get("delayMin") or 0) for train in fleet) / len(fleet)
        return {"answer": f"RailETA currently monitors {len(fleet)} active trains. {len(delayed)} have a reported delay, {len(critical)} are critical, and the average network delay is {average:.1f} minutes.", "sources": ["RailETA operational data"]}

    return {"answer": NO_DATA, "sources": []}
