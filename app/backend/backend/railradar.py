import os
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


@dataclass
class LiveTrainResult:
    data: dict[str, Any] | None
    source: str
    error: str | None = None


class RailRadarProvider:
    """Server-side RailRadar adapter with a small cache to protect API quota."""

    base_url = "https://api.railradar.in/v1"

    def __init__(self) -> None:
        self._cache: dict[str, tuple[float, LiveTrainResult]] = {}
        self._cache_lock = threading.Lock()
        self._refreshing: set[str] = set()

    @property
    def configured(self) -> bool:
        return bool(os.getenv("RAILRADAR_API_KEY"))

    def live_train(self, train_number: str) -> LiveTrainResult:
        return self._get(f"/trains/{train_number}/live", f"live:{train_number}", 90, {
            "authoritative": "true", "includeCoordinates": "true",
        })

    def cached_live_train(self, train_number: str) -> LiveTrainResult | None:
        """Serve the last result immediately; live refresh continues in background."""
        with self._cache_lock:
            cached = self._cache.get(f"live:{train_number}")
            return cached[1] if cached else None

    def refresh_live_train_async(self, train_number: str) -> None:
        cache_key = f"live:{train_number}"
        with self._cache_lock:
            if cache_key in self._refreshing:
                return
            cached = self._cache.get(cache_key)
            if cached and time.monotonic() - cached[0] < 90:
                return
            self._refreshing.add(cache_key)
        def refresh() -> None:
            try:
                self.live_train(train_number)
            finally:
                with self._cache_lock:
                    self._refreshing.discard(cache_key)
        threading.Thread(target=refresh, daemon=True).start()

    def train_directory(self) -> LiveTrainResult:
        # Train numbers and names change far less often than live positions.
        return self._get("/lookup/trains", "directory", 12 * 60 * 60)

    def cached_train_directory(self) -> LiveTrainResult | None:
        """Return the last directory immediately; never wait on the provider."""
        with self._cache_lock:
            cached = self._cache.get("directory")
            return cached[1] if cached else None

    def refresh_train_directory_async(self) -> None:
        """Warm the directory once without making passenger searches wait."""
        with self._cache_lock:
            if "directory" in self._refreshing:
                return
            cached = self._cache.get("directory")
            if cached and time.monotonic() - cached[0] < 12 * 60 * 60:
                return
            self._refreshing.add("directory")

        def refresh() -> None:
            try:
                self.train_directory()
            finally:
                with self._cache_lock:
                    self._refreshing.discard("directory")

        threading.Thread(target=refresh, daemon=True).start()

    def live_map(self) -> LiveTrainResult:
        # One provider request returns the currently running network snapshot.
        return self._get("/legacy/trains/live-map", "live-map", 60)

    def cached_live_map(self) -> LiveTrainResult | None:
        """Return the last live-map result immediately, without provider I/O."""
        with self._cache_lock:
            cached = self._cache.get("live-map")
            return cached[1] if cached else None

    def refresh_live_map_async(self) -> None:
        """Refresh network positions in the background so dashboard requests never block."""
        with self._cache_lock:
            if "live-map" in self._refreshing:
                return
            cached = self._cache.get("live-map")
            if cached and time.monotonic() - cached[0] < 60:
                return
            self._refreshing.add("live-map")

        def refresh() -> None:
            try:
                self.live_map()
            finally:
                with self._cache_lock:
                    self._refreshing.discard("live-map")

        threading.Thread(target=refresh, daemon=True).start()

    def search_stations(self, query: str) -> LiveTrainResult:
        return self._get("/lookup/search/stations", f"stations:{query.lower()}", 60 * 60, {"q": query, "limit": "10"})

    def trains_between(self, origin_code: str, destination_code: str, live: bool = True) -> LiveTrainResult:
        return self._get(
            f"/trains/between/{origin_code}/{destination_code}",
            f"between:{origin_code}:{destination_code}:live={live}",
            300,
            {
                "date": datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat(),
                "live": str(live).lower(),
                "byCity": "true",
            },
        )

    def _get(self, path: str, cache_key: str, ttl_seconds: int, query: dict[str, str] | None = None) -> LiveTrainResult:
        with self._cache_lock:
            cached = self._cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < ttl_seconds:
            return cached[1]
        if not self.configured:
            return LiveTrainResult(None, "simulator", "RailRadar API key is not configured")

        suffix = f"?{urlencode(query)}" if query else ""
        request = Request(
            f"{self.base_url}{path}{suffix}",
            headers={"Authorization": f"Bearer {os.environ['RAILRADAR_API_KEY']}", "Accept": "application/json"},
        )
        try:
            # Passenger search must remain responsive when the provider is slow.
            with urlopen(request, timeout=8) as response:
                import json
                payload = json.loads(response.read().decode("utf-8"))
            error = payload.get("error") or {}
            result = LiveTrainResult(payload.get("data") if payload.get("success") else None, "railradar", None if payload.get("success") else error.get("message", "RailRadar request failed"))
        except HTTPError as error:
            result = LiveTrainResult(None, "simulator", f"RailRadar returned HTTP {error.code}")
        except (URLError, TimeoutError, ValueError, OSError) as error:
            result = LiveTrainResult(None, "simulator", f"RailRadar is unavailable: {error}")
        with self._cache_lock:
            self._cache[cache_key] = (time.monotonic(), result)
        return result


railradar = RailRadarProvider()
