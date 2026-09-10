"""Adapters for non-GPS operational inputs.

Railway control systems can POST normalized events to RailETA, while this
adapter independently refreshes public weather.  Signal and sectional feeds
are intentionally URL-configurable: their credentials and formats are owned
by the operating zone, not hard-coded into the application.
"""
from __future__ import annotations

import json
import time
from threading import Lock
from urllib.parse import urlencode
from urllib.request import urlopen

_weather_cache: dict[tuple[int, int], tuple[float, dict[str, object]]] = {}
_lock = Lock()


def weather_observation(latitude: float, longitude: float, fallback: str = "Clear") -> dict[str, object]:
    """Current Open-Meteo observation, cached by roughly 10 km for two minutes."""
    key = (round(latitude, 1), round(longitude, 1))
    with _lock:
        cached = _weather_cache.get(key)
        if cached and time.monotonic() - cached[0] < 120:
            return cached[1]
    try:
        query = urlencode({"latitude": latitude, "longitude": longitude, "current": "weather_code,temperature_2m,precipitation,wind_speed_10m", "timezone": "Asia/Kolkata"})
        with urlopen(f"https://api.open-meteo.com/v1/forecast?{query}", timeout=3) as response:
            current = json.loads(response.read().decode("utf-8"))["current"]
            code = int(current["weather_code"])
        weather = "Heavy Rain" if code in {65, 75, 82} else "Rain" if code in {51, 53, 55, 61, 63, 80, 81} else "Fog" if code in {45, 48} else "Cloudy" if code in {1, 2, 3} else "Clear"
        observation: dict[str, object] = {"condition": weather, "weatherCode": code, "temperatureC": current.get("temperature_2m"), "precipitationMm": current.get("precipitation"), "windKmph": current.get("wind_speed_10m"), "observedAt": current.get("time"), "source": "open-meteo", "isLive": True}
    except Exception:
        observation = {"condition": fallback, "source": "last-known", "isLive": False}
    with _lock:
        _weather_cache[key] = (time.monotonic(), observation)
    return observation


def weather_for(latitude: float, longitude: float, fallback: str = "Clear") -> str:
    return str(weather_observation(latitude, longitude, fallback)["condition"])


SIGNAL_RESTRICTIONS = {"GREEN": 0.0, "DOUBLE_YELLOW": 0.2, "YELLOW": 0.45, "RED": 1.0, "STOP": 1.0}


def normalize_signal(aspect: str | None, explicit: float | None = None) -> float:
    if explicit is not None:
        return max(0.0, min(1.0, explicit))
    return SIGNAL_RESTRICTIONS.get((aspect or "GREEN").upper().replace(" ", "_"), 0.0)
