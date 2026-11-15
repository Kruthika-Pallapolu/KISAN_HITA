import unittest
from unittest.mock import patch, AsyncMock

try:
    from backend.app.services.intent_router import AssistantOrchestrator
    from backend.app.services.weather_service import WeatherError
    from backend.app.database import clear_conversation_session, get_conversation_session
    _ROUTER_MODULE = "backend.app.services.intent_router"
except ImportError:
    from app.services.intent_router import AssistantOrchestrator
    from app.services.weather_service import WeatherError
    from app.database import clear_conversation_session, get_conversation_session
    _ROUTER_MODULE = "app.services.intent_router"


class TestWeatherConversation(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.fake_forecast = {
            "location": {
                "district": "Nellore",
                "state": "Andhra Pradesh",
                "latitude": 14.44,
                "longitude": 79.98,
            },
            "current": {
                "temperature_2m": 30.5,
                "apparent_temperature": 33.2,
                "weather_code": 0,
            },
            "hourly": {
                "precipitation_probability": [0] * 24,
            },
            "daily": {},
            "provider": "Open-Meteo",
        }

    async def test_two_turn_weather_conversation_telugu(self):
        conv_id = "test_conv_weather_te"
        clear_conversation_session(conv_id)

        # Turn 1: Ask weather without location in Telugu
        resp1 = await AssistantOrchestrator.process_user_query(
            message="ఈరోజు వాతావరణం ఎలా ఉంది?",
            conversation_id=conv_id,
            language="te",
        )
        self.assertEqual(resp1.intent, "weather")
        self.assertEqual(resp1.routed_feature, "weather")
        self.assertIsNone(resp1.pending_workflow)
        self.assertIn("రాష్ట్రం, జిల్లాను చెప్పండి", resp1.reply_text)

        session = get_conversation_session(conv_id)
        self.assertEqual(session.get("pending_workflow"), "weather")

        # Turn 2: Provide state and district in Telugu
        with patch(f"{_ROUTER_MODULE}.get_weather_forecast", new_callable=AsyncMock, return_value=self.fake_forecast) as mock_wf:
            resp2 = await AssistantOrchestrator.process_user_query(
                message="మాది ఆంధ్రప్రదేశ్ రాష్ట్రం, నెల్లూరు జిల్లా.",
                conversation_id=conv_id,
                language="te",
            )
            mock_wf.assert_awaited_once_with(district="Nellore", state="Andhra Pradesh")

        self.assertEqual(resp2.intent, "weather")
        self.assertEqual(resp2.routed_feature, "weather")
        self.assertIsNone(resp2.pending_workflow)
        self.assertIn("నెల్లూరు", resp2.reply_text)
        self.assertIn("ఆంధ్రప్రదేశ్", resp2.reply_text)
        self.assertIn("ప్రత్యక్ష సూచన", resp2.reply_text)
        # Ensure generic failure message was NOT returned
        self.assertNotIn("క్షమించండి, ఈ ప్రశ్నకు నమ్మదగిన సమాధానం", resp2.reply_text)

    async def test_two_turn_weather_conversation_english(self):
        conv_id = "test_conv_weather_en"
        clear_conversation_session(conv_id)

        # Turn 1: Ask weather without location in English
        resp1 = await AssistantOrchestrator.process_user_query(
            message="How is the weather today?",
            conversation_id=conv_id,
            language="en",
        )
        self.assertEqual(resp1.intent, "weather")
        self.assertEqual(resp1.routed_feature, "weather")
        self.assertIsNone(resp1.pending_workflow)
        self.assertIn("Which Indian state and district should I check?", resp1.reply_text)

        # Turn 2: Provide state and district in English
        with patch(f"{_ROUTER_MODULE}.get_weather_forecast", new_callable=AsyncMock, return_value=self.fake_forecast) as mock_wf:
            resp2 = await AssistantOrchestrator.process_user_query(
                message="I am from Nellore district, Andhra Pradesh",
                conversation_id=conv_id,
                language="en",
            )
            mock_wf.assert_awaited_once_with(district="Nellore", state="Andhra Pradesh")

        self.assertEqual(resp2.intent, "weather")
        self.assertEqual(resp2.routed_feature, "weather")
        self.assertIsNone(resp2.pending_workflow)
        self.assertIn("Live forecast for Nellore, Andhra Pradesh", resp2.reply_text)

    async def test_direct_weather_query_does_not_reprompt(self):
        conv_id = "test_conv_weather_direct"
        clear_conversation_session(conv_id)

        with patch(f"{_ROUTER_MODULE}.get_weather_forecast", new_callable=AsyncMock, return_value=self.fake_forecast) as mock_wf:
            resp = await AssistantOrchestrator.process_user_query(
                message="ఈరోజు నెల్లూరులో వాతావరణం ఎలా ఉంది?",
                conversation_id=conv_id,
                language="te",
            )
            mock_wf.assert_awaited_once_with(district="Nellore", state="Andhra Pradesh")

        self.assertEqual(resp.intent, "weather")
        self.assertEqual(resp.routed_feature, "weather")
        self.assertIsNone(resp.pending_workflow)
        self.assertIn("నెల్లూరు", resp.reply_text)

    async def test_weather_service_error_handling_explains_actual_failure(self):
        conv_id = "test_conv_weather_error"
        clear_conversation_session(conv_id)

        # Turn 1
        await AssistantOrchestrator.process_user_query(
            message="ఈరోజు వాతావరణం ఎలా ఉంది?",
            conversation_id=conv_id,
            language="te",
        )

        # Turn 2 with WeatherError
        with patch(f"{_ROUTER_MODULE}.get_weather_forecast", side_effect=WeatherError("weather_provider_unavailable", "Service down", 503)):
            resp2 = await AssistantOrchestrator.process_user_query(
                message="మాది ఆంధ్రప్రదేశ్ రాష్ట్రం, నెల్లూరు జిల్లా.",
                conversation_id=conv_id,
                language="te",
            )

        self.assertEqual(resp2.intent, "weather")
        self.assertEqual(resp2.routed_feature, "weather")
        self.assertEqual(resp2.feature_data.get("status"), "unavailable")
        self.assertIn("ప్రత్యక్ష వాతావరణం తాత్కాలికంగా అందుబాటులో లేదు", resp2.reply_text)
        self.assertNotIn("క్షమించండి, ఈ ప్రశ్నకు నమ్మదగిన సమాధానం", resp2.reply_text)
