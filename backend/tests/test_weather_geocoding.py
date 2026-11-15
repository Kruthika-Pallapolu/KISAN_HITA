import json
import math
import os
import unittest
from collections import defaultdict
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from app.config import settings
from app.services.weather_service import (
    WeatherCoverageUnavailable,
    WeatherError,
    WeatherInvalidLocation,
    WeatherLocationNotFound,
    WeatherProviderUnavailable,
    WeatherService,
    get_forecast,
    resolve_location,
    _geocode_cache,
    _forecast_cache,
)

DIRECTORY = json.loads(
    (Path(__file__).resolve().parents[2] / "frontend/src/data/indiaAdminLgd.json").read_text(encoding="utf-8")
)


def mock_open_meteo_geocode(name="Nellore", state="Andhra Pradesh", lat=14.4426, lon=79.9865):
    return {
        "results": [
            {
                "id": 1,
                "name": name,
                "admin1": state,
                "admin2": name,
                "country_code": "IN",
                "latitude": lat,
                "longitude": lon,
                "feature_code": "ADM2",
            }
        ]
    }


def mock_open_meteo_forecast(lat=14.4426, lon=79.9865, temp=29.5):
    return {
        "current": {
            "temperature_2m": temp,
            "apparent_temperature": temp + 2.0,
            "relative_humidity_2m": 61,
            "precipitation": 0.0,
            "weather_code": 2,
            "wind_speed_10m": 8.0,
            "wind_direction_10m": 225,
            "time": "2026-11-15T12:00",
        },
        "hourly": {
            "time": ["2026-11-15T12:00", "2026-11-15T13:00"],
            "temperature_2m": [temp, temp + 1.0],
            "apparent_temperature": [temp + 2.0, temp + 3.0],
            "precipitation_probability": [10, 15],
            "precipitation": [0.0, 0.0],
            "weather_code": [2, 2],
            "wind_speed_10m": [8.0, 8.5],
        },
        "daily": {
            "time": ["2026-11-15", "2026-11-16", "2026-11-17"],
            "weather_code": [2, 1, 0],
            "temperature_2m_max": [33.0, 32.0, 31.0],
            "temperature_2m_min": [22.0, 21.0, 20.0],
            "precipitation_probability_max": [10, 20, 15],
        },
        "latitude": lat,
        "longitude": lon,
        "units": {"temperature": "°C", "wind_speed": "km/h", "precipitation": "mm"},
    }


class TestWeatherGeocodingAndOpenMeteo(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        _geocode_cache.clear()
        _forecast_cache.clear()
        WeatherService._geocode_cache.clear()
        WeatherService._forecast_cache.clear()
        WeatherService._location_search_cache.clear()
        self.demo_patch = patch.object(settings, "DEMO_DATA_ENABLED", False)
        self.demo_patch.start()
        self.addCleanup(self.demo_patch.stop)

    def test_all_directory_entries_have_canonical_state_links(self):
        state_codes = {state["code"] for state in DIRECTORY["states"]}
        self.assertEqual(len(DIRECTORY["districts"]), 784)
        self.assertEqual(len(DIRECTORY["states"]), 36)
        self.assertTrue(all(d["stateCode"] in state_codes and d["name"].strip() for d in DIRECTORY["districts"]))

    async def test_required_state_district_combinations_validate(self):
        valid = [
            ("Nellore", "Andhra Pradesh"),
            ("Warangal", "Telangana"),
            ("Guntur", "Andhra Pradesh"),
            ("Hyderabad", "Telangana"),
            ("Karnal", "Haryana"),
            ("Aurangabad", "Bihar"),
            ("Chhatrapati Sambhajinagar", "Maharashtra"),
        ]
        for district, state in valid:
            with self.subTest(state=state, district=district):
                selected_state, selected_district = WeatherService._canonical_location(district, state)
                self.assertEqual(selected_state["name"], state)
                self.assertEqual(selected_district["name"], district)

    async def test_invalid_state_district_combinations_are_rejected_before_requests(self):
        for district, state in [("Hyderabad", "Andhra Pradesh"), ("Nellore", "Haryana")]:
            with self.subTest(state=state, district=district):
                with patch("app.services.weather_service._get_json", new=AsyncMock(side_effect=AssertionError("network must not run"))):
                    with self.assertRaises(WeatherError) as caught:
                        await WeatherService.get_district_weather(district, state)
                    self.assertEqual(caught.exception.status_code, 422)

    async def test_duplicate_name_requires_state_and_then_state_scopes(self):
        grouped = defaultdict(list)
        for district in DIRECTORY["districts"]:
            grouped[district["name"].casefold()].append(district)
        duplicated = next(items for items in grouped.values() if len({item["stateCode"] for item in items}) > 1)
        name = duplicated[0]["name"]
        with self.assertRaisesRegex(ValueError, "Select a state"):
            WeatherService._canonical_location(name, None)
        state = next(s["name"] for s in DIRECTORY["states"] if s["code"] == duplicated[0]["stateCode"])
        self.assertEqual(WeatherService._canonical_location(name, state)[0]["name"], state)

    async def test_renamed_district_aliases_resolve_to_canonical_entries(self):
        self.assertEqual(
            WeatherService._canonical_location("Sri Potti Sriramulu Nellore", "Andhra Pradesh")[1]["name"],
            "Nellore",
        )
        self.assertEqual(
            WeatherService._canonical_location("Aurangabad", "Maharashtra")[1]["name"],
            "Chhatrapati Sambhajinagar",
        )
        self.assertEqual(
            WeatherService._canonical_location("Aurangabad", "Bihar")[1]["name"],
            "Aurangabad",
        )

    async def test_open_meteo_district_forecast_response_contract(self):
        with patch("app.services.weather_service._get_json", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = [
                mock_open_meteo_geocode(name="Nellore", state="Andhra Pradesh"),
                mock_open_meteo_forecast(lat=14.4426, lon=79.9865, temp=29.5),
            ]
            weather = await WeatherService.get_district_weather("Nellore", "Andhra Pradesh", "en")

        self.assertEqual((weather.district, weather.state, weather.country), ("Nellore", "Andhra Pradesh", "India"))
        self.assertAlmostEqual(weather.temperature, 29.5)
        self.assertAlmostEqual(weather.feels_like, 31.5)
        self.assertEqual(weather.humidity, 61)
        self.assertAlmostEqual(weather.wind_speed, 8.0)
        self.assertEqual(weather.wind_direction, "SW")
        self.assertEqual(weather.provider, "Open-Meteo")
        self.assertEqual(weather.license, "CC BY 4.0")
        self.assertEqual(len(weather.forecast), 3)
        self.assertEqual(weather.forecast[0].condition_code, 2)
        self.assertFalse(weather.is_official_alert)

    async def test_coordinate_route_uses_coordinates_directly(self):
        with patch("app.services.weather_service._get_json", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_open_meteo_forecast(lat=15.8281, lon=78.0373, temp=28.0)
            weather = await WeatherService.get_coordinate_weather(15.8281, 78.0373, "te")

        self.assertEqual(weather.provider, "Open-Meteo")
        self.assertAlmostEqual(weather.temperature, 28.0)
        self.assertEqual(mock_get.await_count, 1)

    async def test_invalid_coordinates_are_rejected_before_provider_request(self):
        for lat, lon in [(91, 0), (0, 181), (math.inf, 1), ("bad", 1)]:
            with self.subTest(lat=lat, lon=lon):
                with patch("app.services.weather_service._get_json", new=AsyncMock(side_effect=AssertionError("must not call network"))):
                    with self.assertRaises((WeatherError, ValueError)):
                        await WeatherService.get_coordinate_weather(lat, lon)

    async def test_coordinates_outside_india_are_rejected(self):
        # Paris, France coordinates (outside India bounding box 6.0 <= lat <= 38.0 and 68.0 <= lon <= 98.0)
        with self.assertRaises(WeatherCoverageUnavailable):
            WeatherService._verified_indian_coordinates(48.8566, 2.3522)

    async def test_supported_location_catalog_retrieval(self):
        locs = WeatherService.get_supported_locations("Andhra Pradesh")
        self.assertGreater(len(locs), 0)
        self.assertTrue(all(item["region"] == "Andhra Pradesh" for item in locs))
        first_loc = locs[0]
        self.assertIn("location_id", first_loc)
        self.assertIn("name", first_loc)

        # Catalog lookup by ID
        with patch("app.services.weather_service._get_json", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = [
                mock_open_meteo_geocode(name=first_loc["name"], state=first_loc["region"]),
                mock_open_meteo_forecast(),
            ]
            catalog_weather = await WeatherService.get_catalog_location_weather(first_loc["location_id"], "en")
        self.assertEqual(catalog_weather.district, first_loc["name"])
        self.assertEqual(catalog_weather.state, first_loc["region"])

    async def test_nonexistent_catalog_id_raises_not_found(self):
        with self.assertRaises(WeatherLocationNotFound):
            await WeatherService.get_catalog_location_weather(999999)

    async def test_location_query_formats_normalize_and_resolve(self):
        with patch("app.services.weather_service._get_json", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = [
                mock_open_meteo_geocode(name="Nellore", state="Andhra Pradesh"),
                mock_open_meteo_forecast(),
            ]
            weather = await WeatherService.get_location_weather("Andhra Pradesh / Nellore")
        self.assertEqual(weather.district, "Nellore")
        self.assertEqual(weather.state, "Andhra Pradesh")

    async def test_http_errors_and_timeouts_are_handled_safely(self):
        with patch("httpx.AsyncClient.get", new=AsyncMock(side_effect=httpx.TimeoutException("timeout occurred"))):
            with self.assertRaises(WeatherError):
                await WeatherService.get_district_weather("Nellore", "Andhra Pradesh")

    def test_weatherapi_key_compatibility_configuration(self):
        # Compatibility setting exists and does not cause AttributeError
        self.assertTrue(hasattr(settings, "WEATHERAPI_KEY"))
        with patch.object(settings, "WEATHERAPI_KEY", "offline-compatibility-key"):
            self.assertEqual(settings.WEATHERAPI_KEY, "offline-compatibility-key")


if __name__ == "__main__":
    unittest.main()
