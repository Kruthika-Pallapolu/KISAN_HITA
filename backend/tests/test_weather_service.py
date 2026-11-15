import unittest
from unittest.mock import AsyncMock, patch

from backend.app.services.weather_service import (
    WeatherError, get_forecast, resolve_location, _geocode_cache, _forecast_cache,
)
from fastapi import HTTPException
from backend.app.rate_limit import enforce_rate_limit


def geocode(*, name="Nellore", state="Andhra Pradesh", country="IN", lat=14.4426, lon=79.9865, code="ADM2"):
    return {"results": [{"id": 1, "name": name, "admin1": state, "admin2": name,
                         "country_code": country, "latitude": lat, "longitude": lon,
                         "feature_code": code}]}


def forecast(lat=14.4426, lon=79.9865):
    return {
        "current": {"temperature_2m": 30.2, "apparent_temperature": 34.1,
                    "relative_humidity_2m": 60, "precipitation": 0.1,
                    "weather_code": 2, "wind_speed_10m": 12.4,
                    "wind_direction_10m": 240, "time": "2026-11-12T12:00", "cloud_cover": 30},
        "hourly": {"time": ["2026-11-12T12:00", "2026-11-12T13:00"],
                   "temperature_2m": [30.2, 31], "apparent_temperature": [34, 35],
                   "precipitation_probability": [5, 10], "precipitation": [0, 0],
                   "weather_code": [2, 2], "wind_speed_10m": [12, 13]},
        "daily": {"time": ["2026-11-12"], "weather_code": [2],
                  "temperature_2m_max": [32], "temperature_2m_min": [24],
                  "precipitation_probability_max": [10]},
        "latitude": lat, "longitude": lon,
    }


class WeatherServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        _geocode_cache.clear()
        _forecast_cache.clear()

    async def test_nellore_geocoding_and_live_forecast_are_parsed(self):
        with patch("backend.app.services.weather_service._get_json", new_callable=AsyncMock, side_effect=[geocode(), forecast()]) as get_json:
            result = await get_forecast(district="Nellore", state="Andhra Pradesh")
        self.assertEqual(result["location"]["district"], "Nellore")
        self.assertEqual(result["current"]["temperature_2m"], 30.2)
        self.assertEqual(result["provider"], "Open-Meteo")
        self.assertEqual(get_json.await_count, 2)

    async def test_exact_state_membership_rejects_wrong_state_before_network(self):
        with patch("backend.app.services.weather_service._get_json", new_callable=AsyncMock) as get_json:
            with self.assertRaises(WeatherError) as caught:
                await resolve_location("Nellore", "Telangana")
        self.assertEqual(caught.exception.status_code, 422)
        get_json.assert_not_awaited()

    async def test_wrong_country_or_state_geocoder_result_is_not_cached(self):
        for candidate in (geocode(country="US"), geocode(state="Telangana")):
            with self.subTest(candidate=candidate), patch("backend.app.services.weather_service._get_json", new_callable=AsyncMock, return_value=candidate):
                with self.assertRaises(WeatherError):
                    await resolve_location("Nellore", "Andhra Pradesh")
                self.assertEqual(_geocode_cache, {})

    async def test_ambiguous_matches_are_rejected_unless_one_adm2_result_is_unique(self):
        ambiguous = {"results": [
            {"name":"Nellore","admin1":"Andhra Pradesh","admin2":"Nellore","country_code":"IN","latitude":14.4,"longitude":80.0,"feature_code":"PPL"},
            {"name":"Nellore","admin1":"Andhra Pradesh","admin2":"Nellore","country_code":"IN","latitude":14.5,"longitude":80.1,"feature_code":"PPL"},
        ]}
        with patch("backend.app.services.weather_service._get_json", new_callable=AsyncMock, return_value=ambiguous):
            with self.assertRaises(WeatherError) as caught:
                await resolve_location("Nellore", "Andhra Pradesh")
        self.assertEqual(caught.exception.code, "weather_location_ambiguous")
        self.assertFalse(_geocode_cache)

    async def test_invalid_coordinates_timeout_empty_and_malformed_forecast(self):
        with self.assertRaises(WeatherError) as caught:
            await get_forecast(latitude=float("nan"), longitude=80)
        self.assertEqual(caught.exception.code, "invalid_coordinates")
        with patch("backend.app.services.weather_service._get_json", new_callable=AsyncMock, side_effect=WeatherError("weather_provider_timeout", "timeout")):
            with self.assertRaises(WeatherError) as timeout:
                await get_forecast(latitude=14.4, longitude=80)
        self.assertEqual(timeout.exception.code, "weather_provider_timeout")
        for value in ({}, {"current": {}, "hourly": {"time": []}, "daily": {"time": []}}):
            with patch("backend.app.services.weather_service._get_json", new_callable=AsyncMock, return_value=value):
                with self.assertRaises(WeatherError):
                    await get_forecast(latitude=14.4, longitude=80)

    async def test_verified_coordinates_and_forecast_use_separate_caches(self):
        with patch("backend.app.services.weather_service._get_json", new_callable=AsyncMock, side_effect=[geocode(), forecast()]) as get_json:
            await get_forecast(district="Nellore", state="Andhra Pradesh")
            await get_forecast(district="Nellore", state="Andhra Pradesh")
        self.assertEqual(get_json.await_count, 2)
        self.assertEqual(len(_geocode_cache), 1)
        self.assertEqual(len(_forecast_cache), 1)

    async def test_other_known_indian_location_resolves_and_rate_limit_is_enforced(self):
        with patch("backend.app.services.weather_service._get_json", new_callable=AsyncMock, return_value=geocode(name="Warangal", state="Telangana", lat=17.9689, lon=79.5941)):
            location = await resolve_location("Warangal", "Telangana")
        self.assertEqual(location["district"], "Warangal")
        self.assertEqual(location["state"], "Telangana")
        import uuid
        test_session_id = f"disposable-session-{uuid.uuid4()}"
        enforce_rate_limit(None, "weather-test", 1, 60, test_session_id)
        with self.assertRaises(HTTPException) as caught:
            enforce_rate_limit(None, "weather-test", 1, 60, test_session_id)
        self.assertEqual(caught.exception.status_code, 429)

    def test_multilingual_state_and_district_map_to_canonical(self):
        from backend.app.services.weather_service import _canonical_state, _canonical_district
        self.assertEqual(_canonical_state("ఆంధ్రప్రదేశ్"), "Andhra Pradesh")
        nellore = _canonical_district("నెల్లూరు", "ఆంధ్రప్రదేశ్")
        self.assertIsNotNone(nellore)
        self.assertEqual(nellore["name"], "Nellore")

        guntur = _canonical_district("గుంటూరు", "ఆంధ్రప్రదేశ్")
        self.assertIsNotNone(guntur)
        self.assertEqual(guntur["name"], "Guntur")

        kolar = _canonical_district("ಕೋಲಾರ", "ಕರ್ನಾಟಕ")
        self.assertIsNotNone(kolar)
        self.assertEqual(kolar["name"], "Kolar")

        pune = _canonical_district("पुणे", "महाराष्ट्र")
        self.assertIsNotNone(pune)
        self.assertEqual(pune["name"], "Pune")

        anakapalli = _canonical_district("అనకాపల్లి", "ఆంధ్రప్రదేశ్")
        self.assertIsNotNone(anakapalli)
        self.assertEqual(anakapalli["name"], "Anakapalli")

    async def test_anakapalli_resolves_via_verified_coordinates_when_generic_geocoding_is_empty(self):
        with patch("backend.app.services.weather_service._get_json", new_callable=AsyncMock, return_value={"results": []}):
            res = await resolve_location("Anakapalli", "Andhra Pradesh")
        self.assertEqual(res["district"], "Anakapalli")
        self.assertEqual(res["state"], "Andhra Pradesh")
        self.assertAlmostEqual(res["latitude"], 17.6913, places=3)
        self.assertAlmostEqual(res["longitude"], 83.0040, places=3)
        self.assertEqual(res["source"], "Verified Indian District Registry / Open-Meteo")

    async def test_unverified_district_rejected_for_manual_request(self):
        with self.assertRaises(WeatherError) as caught:
            await resolve_location("Arvalli", "Gujarat")
        self.assertEqual(caught.exception.code, "weather_coverage_unavailable")
        self.assertEqual(caught.exception.status_code, 503)

    async def test_gps_request_works_without_district_validation(self):
        with patch("backend.app.services.weather_service._get_json", new_callable=AsyncMock, return_value=forecast(lat=34.1526, lon=77.5771)) as get_json:
            result = await get_forecast(latitude=34.1526, longitude=77.5771)
        self.assertEqual(result["location"]["source"], "User-provided coordinates")
        self.assertEqual(result["location"]["latitude"], 34.1526)
        self.assertEqual(result["provider"], "Open-Meteo")

    def test_exactly_309_supported_districts_loaded(self):
        from backend.app.services.weather_service import _weather_supported_districts
        self.assertEqual(len(_weather_supported_districts), 309)



if __name__ == "__main__":
    unittest.main()
