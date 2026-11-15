import unittest
import asyncio
import base64
import os
import sys
from unittest.mock import patch
import speech_recognition as sr
from fastapi.testclient import TestClient
from fastapi import HTTPException
from auth_helpers import authenticated_client

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.main import app
from app.config import settings
from app.services.gnani_voice import (
    generate_mock_wav,
    get_voice_provider,
    MockGnaniProvider,
    LiveGnaniProvider,
    GNANI_LANG_MAP,
    TIMBRE_V30_VOICES
)
from app.services.gnani_voice import DormantGnaniVoiceProvider, detect_gnani_audio_mime
from app.models.schemas import STTResponse, TTSResponse
from app.routers.voice import validate_audio_format


class FakePrismaProvider:
    async def speech_to_text(self, audio_bytes, language):
        return STTResponse(
            transcript="mocked Prisma transcript",
            confidence=None,
            language=language,
            is_mock=False,
            model="prisma-v3.0",
            provider="gnani_live",
        )


class FakeTimbreProvider:
    async def text_to_speech(self, text, language, voice=None, speed=1.0, http_client=None):
        audio = generate_mock_wav(0.1)
        return TTSResponse(
            audio_base64=base64.b64encode(audio).decode("ascii"),
            format="audio/wav",
            language=language,
            voice_name="Vasudha",
            model="timbre-v3.0",
            provider="gnani_live",
            is_mock=False,
        )

class TestVoiceModule(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = authenticated_client(app)
        cls.valid_wav = generate_mock_wav(0.3)
        cls.valid_b64 = base64.b64encode(cls.valid_wav).decode("utf-8")

    def setUp(self):
        from app.database import get_db_connection
        conn = get_db_connection()
        with conn:
            conn.execute("DELETE FROM api_rate_limits")

    def test_voice_imports_and_initialization(self):
        """Verifies voice providers and language mappings are properly initialized."""
        provider = get_voice_provider()
        self.assertIsInstance(provider, MockGnaniProvider)
        self.assertEqual(len(GNANI_LANG_MAP), 7)
        self.assertEqual(len(TIMBRE_V30_VOICES), 13)
        self.assertEqual(GNANI_LANG_MAP["te"], "te-IN")
        self.assertIn("Vasudha", TIMBRE_V30_VOICES)

    def test_mock_stt_request_and_response(self):
        """Exercises all seven language routes with a mocked Prisma provider."""
        for lang in ["te", "en", "hi", "ta", "kn", "ml", "mr"]:
            with patch("app.routers.voice.get_voice_provider", return_value=FakePrismaProvider()):
                res = self.client.post("/api/voice/stt", json={
                    "audio_base64": self.valid_b64,
                    "language": lang
                })
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertFalse(data["is_mock"])
            self.assertEqual(data["model"], "prisma-v3.0")
            self.assertEqual(data["provider"], "gnani_live")
            self.assertEqual(data["language"], lang)
            self.assertEqual(data["transcript"], "mocked Prisma transcript")
            self.assertIsNone(data["confidence"])

    def test_mock_tts_request_and_response(self):
        """Disabled Timbre reports an actionable error instead of fake/browser audio."""
        original = (settings.GNANI_LIVE_ENABLED, settings.GNANI_TIMBRE_ENABLED)
        try:
            settings.GNANI_LIVE_ENABLED = False
            settings.GNANI_TIMBRE_ENABLED = False
            for lang in ["te", "hi", "en"]:
                res = self.client.post("/api/voice/tts", json={
                    "text": "A mocked voice test.",
                    "language": lang
                })
                self.assertEqual(res.status_code, 503)
                self.assertIn("GNANI_LIVE_ENABLED", res.json()["detail"])
                self.assertNotIn("audio_base64", res.json())
        finally:
            settings.GNANI_LIVE_ENABLED, settings.GNANI_TIMBRE_ENABLED = original

    def test_invalid_audio_input_handling(self):
        """Verifies proper HTTP 400 error when audio is malformed or too short."""
        # Empty string
        res1 = self.client.post("/api/voice/stt", json={"audio_base64": "", "language": "en"})
        self.assertEqual(res1.status_code, 400)
        
        # Corrupted base64
        res2 = self.client.post("/api/voice/stt", json={"audio_base64": "!!!not_valid_b64!!!", "language": "en"})
        self.assertEqual(res2.status_code, 400)
        
        # Audio bytes smaller than 44-byte header
        tiny_b64 = base64.b64encode(b"short").decode("utf-8")
        res3 = self.client.post("/api/voice/stt", json={"audio_base64": tiny_b64, "language": "en"})
        self.assertEqual(res3.status_code, 400)

    def test_unsupported_language_handling(self):
        """Verifies HTTP 422 error when unsupported language is passed."""
        res = self.client.post("/api/voice/stt", json={
            "audio_base64": self.valid_b64,
            "language": "unsupported_xyz"
        })
        self.assertEqual(res.status_code, 422)
        self.assertTrue(
            any("Unsupported language" in str(err) for err in res.json().get("detail", []))
            or "Unsupported language" in str(res.json())
        )

    def test_empty_text_in_tts(self):
        """Verifies HTTP 400 error when text input is empty, whitespace, or empty after symbol stripping."""
        # Pure whitespace
        res1 = self.client.post("/api/voice/tts", json={"text": "   ", "language": "en"})
        self.assertEqual(res1.status_code, 400)
        self.assertIn("cannot be empty", res1.json()["detail"])

        # Empty string
        res2 = self.client.post("/api/voice/tts", json={"text": "", "language": "en"})
        self.assertEqual(res2.status_code, 400)
        self.assertIn("cannot be empty", res2.json()["detail"])

        # Markdown/symbol only string that becomes empty after stripping
        res3 = self.client.post("/api/voice/tts", json={"text": " * # ` ", "language": "en"})
        self.assertIn(res3.status_code, [400, 422])
        self.assertIn("cannot be empty", str(res3.json()))

    def test_tts_length_boundary_and_resilience(self):
        """Verifies the mocked Timbre route handles assistant response size boundaries."""
        # 600-character text (typical Crop Advisor / Check Crop readout)
        long_text_600 = "Farmer advisory: " + ("Paddy crop requires steady water management. " * 12)
        self.assertGreater(len(long_text_600), 550)
        # 1500-character text (typical detailed assistant response)
        long_text_1500 = "Agricultural advisory summary: " + ("Healthy soil requires balanced nitrogen and phosphorus. " * 30)
        self.assertGreater(len(long_text_1500), 1200)
        with patch("app.routers.voice.get_voice_provider", return_value=FakeTimbreProvider()):
            res600 = self.client.post("/api/voice/tts", json={"text": long_text_600, "language": "en"})
            res1500 = self.client.post("/api/voice/tts", json={"text": long_text_1500, "language": "en"})
        self.assertEqual(res600.status_code, 200)
        self.assertEqual(res600.json()["model"], "timbre-v3.0")
        self.assertEqual(res1500.status_code, 200)
        self.assertEqual(res1500.json()["model"], "timbre-v3.0")

        # Text exceeding 2000 characters -> HTTP 422 (Pydantic validation limit)
        oversized = "X" * 2001
        res_over = self.client.post("/api/voice/tts", json={"text": oversized, "language": "en"})
        self.assertEqual(res_over.status_code, 422)

    def test_tts_invalid_and_missing_payloads(self):
        """Verifies HTTP 422 validation errors for missing, null, or out-of-bound fields."""
        # Missing text field entirely
        res_missing = self.client.post("/api/voice/tts", json={"language": "en"})
        self.assertEqual(res_missing.status_code, 422)

        # None/null text
        res_none = self.client.post("/api/voice/tts", json={"text": None, "language": "en"})
        self.assertEqual(res_none.status_code, 422)

        # Speed out of bounds (< 0.5 or > 2.0)
        res_speed = self.client.post("/api/voice/tts", json={"text": "Hello", "speed": 3.0})
        self.assertEqual(res_speed.status_code, 422)

        # Unsupported language code
        res_lang = self.client.post("/api/voice/tts", json={"text": "Hello", "language": "spanish"})
        self.assertEqual(res_lang.status_code, 422)

    def test_all_7_languages_tts_and_locale_tags(self):
        """All seven language codes produce mocked Timbre metadata with Vasudha."""
        with patch("app.routers.voice.get_voice_provider", return_value=FakeTimbreProvider()):
            for lang in ["te", "en", "hi", "ta", "kn", "ml", "mr"]:
                res = self.client.post("/api/voice/tts", json={
                    "text": "నమస్కారం రైతు సోదరులకు",
                    "language": lang,
                })
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.json()["model"], "timbre-v3.0")
                self.assertEqual(res.json()["voice_name"], "Vasudha")
                self.assertFalse(res.json()["is_mock"])

    def test_live_gnani_calls_blocked_when_disabled(self):
        """CRITICAL: Verifies live Gnani API calls raise an error when GNANI_LIVE_ENABLED=false."""
        self.assertFalse(settings.GNANI_LIVE_ENABLED)
        live_provider = LiveGnaniProvider()
        
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        # Attempt both modalities with a patched HTTP client to prove no outbound request occurs.
        with patch("app.services.gnani_voice.httpx.AsyncClient") as client:
            with self.assertRaises(RuntimeError) as ctx1:
                loop.run_until_complete(live_provider.speech_to_text(self.valid_wav, "en"))
            with self.assertRaises(RuntimeError) as ctx2:
                loop.run_until_complete(live_provider.text_to_speech("test", "en"))
            self.assertEqual(client.call_count, 0)
        self.assertIn("Gnani live integration is disabled", str(ctx1.exception))
        self.assertIn("Gnani live integration is disabled", str(ctx2.exception))
        
        loop.close()

    def test_live_gnani_missing_credentials(self):
        """Verifies LiveGnaniProvider raises descriptive error if enabled but API key is missing."""
        original_state = settings.GNANI_LIVE_ENABLED
        original_allow_paid = settings.GNANI_ALLOW_PAID_LIVE_CALLS
        original_prisma = settings.GNANI_PRISMA_ENABLED
        original_key = settings.GNANI_API_KEY
        try:
            settings.GNANI_LIVE_ENABLED = True
            settings.GNANI_ALLOW_PAID_LIVE_CALLS = True
            settings.GNANI_PRISMA_ENABLED = True
            settings.GNANI_API_KEY = ""
            live_provider = LiveGnaniProvider()
            
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            with self.assertRaises(RuntimeError) as ctx:
                loop.run_until_complete(live_provider.speech_to_text(self.valid_wav, "en"))
            self.assertIn("Gnani API key is missing", str(ctx.exception))
            
            loop.close()
        finally:
            settings.GNANI_LIVE_ENABLED = original_state
            settings.GNANI_ALLOW_PAID_LIVE_CALLS = original_allow_paid
            settings.GNANI_PRISMA_ENABLED = original_prisma
            settings.GNANI_API_KEY = original_key

    def test_gnani_paid_safety_guard_four_combinations_stt_and_tts(self):
        """CRITICAL: Verifies all 4 combinations of GNANI_LIVE_ENABLED and GNANI_ALLOW_PAID_LIVE_CALLS.
        1. False, False -> BLOCKED (zero outbound HTTP calls)
        2. False, True  -> BLOCKED (zero outbound HTTP calls)
        3. True,  False -> BLOCKED (zero outbound HTTP calls)
        4. True,  True  -> ALLOWED (mocked HTTP client, zero live requests)
        """
        from unittest.mock import MagicMock, AsyncMock
        original = (
            settings.GNANI_LIVE_ENABLED,
            settings.GNANI_ALLOW_PAID_LIVE_CALLS,
            settings.GNANI_PRISMA_ENABLED,
            settings.GNANI_TIMBRE_ENABLED,
            settings.GNANI_API_KEY,
            settings.GNANI_TIMBRE_VOICE_TE,
        )
        try:
            settings.GNANI_PRISMA_ENABLED = True
            settings.GNANI_TIMBRE_ENABLED = True
            settings.GNANI_API_KEY = "test-mock-key"
            settings.GNANI_TIMBRE_VOICE_TE = "Vasudha"

            live_provider = LiveGnaniProvider()
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

            # Matrix of (GNANI_LIVE_ENABLED, GNANI_ALLOW_PAID_LIVE_CALLS, should_allow)
            matrix = [
                (False, False, False),
                (False, True, False),
                (True, False, False),
                (True, True, True),
            ]

            for live_enabled, allow_paid, should_allow in matrix:
                settings.GNANI_LIVE_ENABLED = live_enabled
                settings.GNANI_ALLOW_PAID_LIVE_CALLS = allow_paid

                if not should_allow:
                    # Mock HTTP client to verify it is NEVER called
                    with patch("app.services.gnani_voice.httpx.AsyncClient") as mock_client:
                        # STT must be blocked
                        with self.assertRaises(RuntimeError) as ctx_stt:
                            loop.run_until_complete(live_provider.speech_to_text(self.valid_wav, "te"))
                        # TTS must be blocked
                        with self.assertRaises(RuntimeError) as ctx_tts:
                            loop.run_until_complete(live_provider.text_to_speech("నమస్కారం", "te"))
                        # Verify zero outbound calls were initiated
                        self.assertEqual(mock_client.call_count, 0)
                        # Error messages indicate disabled or unauthorized
                        self.assertTrue(
                            "disabled" in str(ctx_stt.exception) or "unauthorized" in str(ctx_stt.exception)
                        )
                        self.assertTrue(
                            "disabled" in str(ctx_tts.exception) or "unauthorized" in str(ctx_tts.exception)
                        )
                else:
                    # When both are True, requests proceed to the HTTP client (mocked)
                    fake_stt_response = MagicMock()
                    fake_stt_response.status_code = 200
                    fake_stt_response.json.return_value = {
                        "success": True,
                        "transcript": "నమస్కారం",
                        "model": "prisma-v3.0",
                        "processing_time": 0.12,
                    }

                    fake_tts_response = MagicMock()
                    fake_tts_response.status_code = 200
                    fake_tts_response.content = self.valid_wav  # RIFF WAVE bytes

                    mock_instance = AsyncMock()
                    mock_instance.post.side_effect = [fake_stt_response, fake_tts_response]
                    mock_instance.__aenter__.return_value = mock_instance
                    mock_instance.__aexit__.return_value = None

                    with patch("app.services.gnani_voice.httpx.AsyncClient", return_value=mock_instance):
                        stt_res = loop.run_until_complete(live_provider.speech_to_text(self.valid_wav, "te"))
                        self.assertEqual(stt_res.transcript, "నమస్కారం")
                        self.assertEqual(stt_res.model, "prisma-v3.0")

                        tts_res = loop.run_until_complete(live_provider.text_to_speech("నమస్కారం", "te", http_client=mock_instance))
                        self.assertEqual(tts_res.format, "audio/wav")
                        self.assertEqual(tts_res.voice_name, "Vasudha")

            loop.close()
        finally:
            (
                settings.GNANI_LIVE_ENABLED,
                settings.GNANI_ALLOW_PAID_LIVE_CALLS,
                settings.GNANI_PRISMA_ENABLED,
                settings.GNANI_TIMBRE_ENABLED,
                settings.GNANI_API_KEY,
                settings.GNANI_TIMBRE_VOICE_TE,
            ) = original

    def test_dotenv_alone_cannot_set_gnani_allow_paid_live_calls(self):
        """CRITICAL: Verifies that GNANI_ALLOW_PAID_LIVE_CALLS is captured from the process
        environment before dotenv loading, so .env alone can NEVER enable paid calls."""
        from app.config import _INITIAL_PROCESS_ENV
        if "GNANI_ALLOW_PAID_LIVE_CALLS" not in _INITIAL_PROCESS_ENV:
            self.assertFalse(settings.GNANI_ALLOW_PAID_LIVE_CALLS)

    def test_gnani_flags_are_independent_and_global_master_wins(self):
        original = (settings.GNANI_LIVE_ENABLED, settings.GNANI_PRISMA_ENABLED, settings.GNANI_TIMBRE_ENABLED, settings.GNANI_API_KEY)
        try:
            settings.GNANI_API_KEY = "test-only-not-a-real-key"
            settings.GNANI_LIVE_ENABLED = False
            settings.GNANI_PRISMA_ENABLED = True
            settings.GNANI_TIMBRE_ENABLED = True
            with self.assertRaisesRegex(RuntimeError, "GNANI_LIVE_ENABLED"):
                get_voice_provider("stt", "te")
            with self.assertRaisesRegex(RuntimeError, "GNANI_LIVE_ENABLED"):
                get_voice_provider("tts")
            settings.GNANI_LIVE_ENABLED = True
            settings.GNANI_PRISMA_ENABLED = True
            settings.GNANI_TIMBRE_ENABLED = False
            self.assertIsInstance(get_voice_provider("stt", "te"), DormantGnaniVoiceProvider)
            with self.assertRaisesRegex(RuntimeError, "GNANI_TIMBRE_ENABLED"):
                get_voice_provider("tts")
            settings.GNANI_PRISMA_ENABLED = False
            settings.GNANI_TIMBRE_ENABLED = True
            with self.assertRaisesRegex(RuntimeError, "GNANI_PRISMA_ENABLED"):
                get_voice_provider("stt", "te")
            self.assertIsInstance(get_voice_provider("tts"), DormantGnaniVoiceProvider)
        finally:
            settings.GNANI_LIVE_ENABLED, settings.GNANI_PRISMA_ENABLED, settings.GNANI_TIMBRE_ENABLED, settings.GNANI_API_KEY = original

    def test_direct_provider_calls_respect_each_modality_switch(self):
        original = (settings.GNANI_LIVE_ENABLED, settings.GNANI_ALLOW_PAID_LIVE_CALLS, settings.GNANI_PRISMA_ENABLED, settings.GNANI_TIMBRE_ENABLED)
        try:
            settings.GNANI_LIVE_ENABLED = True
            settings.GNANI_ALLOW_PAID_LIVE_CALLS = True
            settings.GNANI_PRISMA_ENABLED = False
            settings.GNANI_TIMBRE_ENABLED = False
            with patch("app.services.gnani_voice.httpx.AsyncClient") as client:
                with self.assertRaisesRegex(RuntimeError, "Prisma is disabled"):
                    asyncio.run(DormantGnaniVoiceProvider().speech_to_text(self.valid_wav, "en"))
                with self.assertRaisesRegex(RuntimeError, "Timbre is disabled"):
                    asyncio.run(DormantGnaniVoiceProvider().text_to_speech("hello", "en", voice="Vasudha"))
                client.assert_not_called()
        finally:
            settings.GNANI_LIVE_ENABLED, settings.GNANI_ALLOW_PAID_LIVE_CALLS, settings.GNANI_PRISMA_ENABLED, settings.GNANI_TIMBRE_ENABLED = original

    def test_prisma_formats_and_webm_is_never_mislabeled(self):
        self.assertEqual(detect_gnani_audio_mime(self.valid_wav), "audio/wav")
        self.assertEqual(detect_gnani_audio_mime(b"ID3" + b"\0" * 50), "audio/mpeg")
        self.assertEqual(detect_gnani_audio_mime(b"OggS" + b"\0" * 50), "audio/ogg")
        self.assertEqual(detect_gnani_audio_mime(b"fLaC" + b"\0" * 50), "audio/flac")
        self.assertEqual(detect_gnani_audio_mime(b"\xff\xf1" + b"\0" * 50), "audio/aac")
        self.assertEqual(detect_gnani_audio_mime(b"\0\0\0\x18ftypM4A " + b"\0" * 50), "audio/mp4")
        self.assertEqual(detect_gnani_audio_mime(b"\x1a\x45\xdf\xa3" + b"\0" * 50), "audio/webm")

    def test_prisma_mock_response_contract_and_no_fabricated_confidence(self):
        class FakeResponse:
            status_code = 200
            def json(self):
                return {"success": True, "transcript": "Which crop suits cotton soil?", "model": "prisma-v3.0", "detected_language_code": "en-IN", "processing_time": 0.4}
        class FakeClient:
            async def __aenter__(self): return self
            async def __aexit__(self, *args): return False
            async def post(self, url, **kwargs):
                self.kwargs = kwargs
                self.url = url
                return FakeResponse()
        fake = FakeClient()
        original = (settings.GNANI_LIVE_ENABLED, settings.GNANI_ALLOW_PAID_LIVE_CALLS, settings.GNANI_PRISMA_ENABLED, settings.GNANI_API_KEY)
        try:
            settings.GNANI_LIVE_ENABLED = True
            settings.GNANI_ALLOW_PAID_LIVE_CALLS = True
            settings.GNANI_PRISMA_ENABLED = True
            settings.GNANI_API_KEY = "test-only-not-a-real-key"
            with patch("app.services.gnani_voice.httpx.AsyncClient", return_value=fake):
                result = asyncio.run(DormantGnaniVoiceProvider().speech_to_text(self.valid_wav, "en"))
            self.assertEqual(fake.url, settings.GNANI_STT_URL)
            self.assertEqual(fake.kwargs["headers"]["X-API-Key-ID"], "test-only-not-a-real-key")
            self.assertIn("audio_file", fake.kwargs["files"])
            self.assertEqual(fake.kwargs["files"]["audio_file"][2], "audio/wav")
            self.assertEqual(fake.kwargs["data"], {"model": "prisma-v3.0", "language_code": "indic-auto", "format": "codemix"})
            self.assertEqual(result.transcript, "Which crop suits cotton soil?")
            self.assertIsNone(result.confidence)
            self.assertEqual(result.processing_time_ms, 400)
        finally:
            settings.GNANI_LIVE_ENABLED, settings.GNANI_ALLOW_PAID_LIVE_CALLS, settings.GNANI_PRISMA_ENABLED, settings.GNANI_API_KEY = original

    def test_audio_upload_duration_limit_and_chrome_webm_format_detection(self):
        too_long = self.client.post(
            "/api/voice/stt/upload",
            files={"file": ("voice.wav", self.valid_wav, "audio/wav")},
            data={"language": "en", "duration_seconds": "30.1"},
        )
        self.assertEqual(too_long.status_code, 422)
        webm_audio = b"\x1a\x45\xdf\xa3" + b"\0" * 60
        with self.assertRaises(HTTPException) as error:
            validate_audio_format(webm_audio)
        self.assertEqual(error.exception.status_code, 415)
        self.assertIn("Prisma v3.0", error.exception.detail)
        unsupported = b"\0" * 64
        with self.assertRaises(HTTPException):
            validate_audio_format(unsupported)

    def test_disabled_prisma_and_timbre_make_no_gnani_http_requests(self):
        original = (settings.GNANI_LIVE_ENABLED, settings.GNANI_PRISMA_ENABLED, settings.GNANI_TIMBRE_ENABLED)
        try:
            settings.GNANI_LIVE_ENABLED = False
            settings.GNANI_PRISMA_ENABLED = True
            settings.GNANI_TIMBRE_ENABLED = True
            with patch("app.services.gnani_voice.httpx.AsyncClient") as client:
                with self.assertRaisesRegex(RuntimeError, "GNANI_LIVE_ENABLED"):
                    get_voice_provider("stt", "te")
                with self.assertRaisesRegex(RuntimeError, "GNANI_LIVE_ENABLED"):
                    get_voice_provider("tts")
                self.assertEqual(client.call_count, 0)
        finally:
            settings.GNANI_LIVE_ENABLED, settings.GNANI_PRISMA_ENABLED, settings.GNANI_TIMBRE_ENABLED = original

    def test_timbre_mock_binary_audio_and_voice_language_validation(self):
        class FakeResponse:
            status_code = 200
            content = generate_mock_wav()
        class FakeClient:
            async def __aenter__(self): return self
            async def __aexit__(self, *args): return False
            async def post(self, url, **kwargs):
                self.url, self.kwargs = url, kwargs
                return FakeResponse()
        fake = FakeClient()
        original = (settings.GNANI_LIVE_ENABLED, settings.GNANI_ALLOW_PAID_LIVE_CALLS, settings.GNANI_TIMBRE_ENABLED, settings.GNANI_API_KEY, settings.GNANI_TIMBRE_VOICE_TE)
        try:
            settings.GNANI_LIVE_ENABLED = True
            settings.GNANI_ALLOW_PAID_LIVE_CALLS = True
            settings.GNANI_TIMBRE_ENABLED = True
            settings.GNANI_API_KEY = "test-only-not-a-real-key"
            settings.GNANI_TIMBRE_VOICE_TE = "Vasudha"
            with patch("app.services.gnani_voice.httpx.AsyncClient", return_value=fake):
                result = asyncio.run(DormantGnaniVoiceProvider().text_to_speech("నమస్కారం", "te"))
            self.assertEqual(fake.url, settings.GNANI_TTS_URL)
            self.assertEqual(fake.kwargs["headers"]["X-API-Key-ID"], "test-only-not-a-real-key")
            self.assertEqual(fake.kwargs["json"]["model"], "timbre-v3.0")
            self.assertEqual(fake.kwargs["json"]["voice"], "Vasudha")
            self.assertEqual(base64.b64decode(result.audio_base64)[:4], b"RIFF")
            with self.assertRaises(ValueError):
                asyncio.run(DormantGnaniVoiceProvider().text_to_speech("hello", "te", voice="Nalini"))
            with self.assertRaises(ValueError):
                asyncio.run(DormantGnaniVoiceProvider().text_to_speech("hello", "te", speed=1.2))
        finally:
            settings.GNANI_LIVE_ENABLED, settings.GNANI_ALLOW_PAID_LIVE_CALLS, settings.GNANI_TIMBRE_ENABLED, settings.GNANI_API_KEY, settings.GNANI_TIMBRE_VOICE_TE = original

    def test_timbre_voice_settings_are_independent_and_vasudha_is_selected_per_language(self):
        language_fields = {
            "en-IN": "GNANI_TIMBRE_VOICE_EN", "te-IN": "GNANI_TIMBRE_VOICE_TE",
            "hi-IN": "GNANI_TIMBRE_VOICE_HI", "ta-IN": "GNANI_TIMBRE_VOICE_TA",
            "kn-IN": "GNANI_TIMBRE_VOICE_KN", "ml-IN": "GNANI_TIMBRE_VOICE_ML",
            "mr-IN": "GNANI_TIMBRE_VOICE_MR",
        }
        languages = {"en-IN": "en", "te-IN": "te", "hi-IN": "hi", "ta-IN": "ta", "kn-IN": "kn", "ml-IN": "ml", "mr-IN": "mr"}
        original = {field: getattr(settings, field) for field in language_fields.values()}
        original.update({"GNANI_LIVE_ENABLED": settings.GNANI_LIVE_ENABLED, "GNANI_ALLOW_PAID_LIVE_CALLS": settings.GNANI_ALLOW_PAID_LIVE_CALLS, "GNANI_TIMBRE_ENABLED": settings.GNANI_TIMBRE_ENABLED, "GNANI_API_KEY": settings.GNANI_API_KEY})
        try:
            settings.GNANI_LIVE_ENABLED = True
            settings.GNANI_ALLOW_PAID_LIVE_CALLS = True
            settings.GNANI_TIMBRE_ENABLED = True
            settings.GNANI_API_KEY = "test-only-not-a-real-key"
            for field in language_fields.values():
                setattr(settings, field, "")
            with patch("app.services.gnani_voice.httpx.AsyncClient") as http_client:
                for locale, field in language_fields.items():
                    with self.subTest(locale=locale):
                        with self.assertRaisesRegex(RuntimeError, "No Timbre v3.0 voice has been selected"):
                            asyncio.run(DormantGnaniVoiceProvider().text_to_speech("sample", languages[locale]))
                self.assertEqual(http_client.call_count, 0)

            settings.GNANI_TIMBRE_VOICE_TE = "Vasudha"
            with self.assertRaisesRegex(ValueError, "does not match the configured voice"):
                asyncio.run(DormantGnaniVoiceProvider().text_to_speech(
                    "sample", "te", voice="not-a-catalogue-voice"
                ))

            class FakeResponse:
                status_code = 200
                content = generate_mock_wav()
            class FakeClient:
                async def __aenter__(self): return self
                async def __aexit__(self, *args): return False
                async def post(self, url, **kwargs):
                    self.url, self.kwargs = url, kwargs
                    return FakeResponse()
            for locale, field in language_fields.items():
                with self.subTest(locale=locale, configured=True):
                    voice = "Vasudha"
                    setattr(settings, field, voice)
                    fake = FakeClient()
                    with patch("app.services.gnani_voice.httpx.AsyncClient", return_value=fake):
                        response = asyncio.run(DormantGnaniVoiceProvider().text_to_speech("sample", languages[locale]))
                    self.assertEqual(fake.kwargs["json"]["language"], locale)
                    self.assertEqual(fake.kwargs["json"]["voice"], voice)
                    self.assertEqual(fake.kwargs["json"]["audio_config"], {
                        "encoding": "linear_pcm", "container": "wav", "num_channels": 1,
                        "sample_rate": 48000, "sample_width": 2,
                    })
                    self.assertEqual(response.model, "timbre-v3.0")
        finally:
            settings.GNANI_LIVE_ENABLED = original["GNANI_LIVE_ENABLED"]
            settings.GNANI_ALLOW_PAID_LIVE_CALLS = original["GNANI_ALLOW_PAID_LIVE_CALLS"]
            settings.GNANI_TIMBRE_ENABLED = original["GNANI_TIMBRE_ENABLED"]
            settings.GNANI_API_KEY = original["GNANI_API_KEY"]
            for field, value in original.items():
                if field.startswith("GNANI_TIMBRE_VOICE_"):
                    setattr(settings, field, value)

    def test_provider_timeout_and_malformed_responses_fail_without_fabrication(self):
        import httpx
        original = (settings.GNANI_LIVE_ENABLED, settings.GNANI_ALLOW_PAID_LIVE_CALLS, settings.GNANI_PRISMA_ENABLED, settings.GNANI_TIMBRE_ENABLED, settings.GNANI_API_KEY, settings.GNANI_TIMBRE_VOICE_EN)
        class TimeoutClient:
            async def __aenter__(self): return self
            async def __aexit__(self, *args): return False
            async def post(self, *args, **kwargs): raise httpx.ReadTimeout("private transport detail")
        class BadResponse:
            status_code = 200
            def json(self): return {"success": True, "transcript": None}
        class BadClient:
            async def __aenter__(self): return self
            async def __aexit__(self, *args): return False
            async def post(self, *args, **kwargs): return BadResponse()
        try:
            settings.GNANI_LIVE_ENABLED = True
            settings.GNANI_ALLOW_PAID_LIVE_CALLS = True
            settings.GNANI_PRISMA_ENABLED = True
            settings.GNANI_TIMBRE_ENABLED = True
            settings.GNANI_API_KEY = "test-only-not-a-real-key"
            settings.GNANI_TIMBRE_VOICE_EN = "Kaveri"
            with patch("app.services.gnani_voice.httpx.AsyncClient", return_value=TimeoutClient()):
                with self.assertRaisesRegex(RuntimeError, "timed out"):
                    asyncio.run(DormantGnaniVoiceProvider().speech_to_text(self.valid_wav, "en"))
            with patch("app.services.gnani_voice.httpx.AsyncClient", return_value=BadClient()):
                with self.assertRaisesRegex(RuntimeError, "invalid transcription response"):
                    asyncio.run(DormantGnaniVoiceProvider().speech_to_text(self.valid_wav, "en"))
        finally:
            settings.GNANI_LIVE_ENABLED, settings.GNANI_ALLOW_PAID_LIVE_CALLS, settings.GNANI_PRISMA_ENABLED, settings.GNANI_TIMBRE_ENABLED, settings.GNANI_API_KEY, settings.GNANI_TIMBRE_VOICE_EN = original

    def test_prisma_empty_transcript_is_valid_no_speech_response(self):
        class EmptyTranscriptResponse:
            status_code = 200
            def json(self): return {"success": True, "transcript": ""}
        class FakeClient:
            async def __aenter__(self): return self
            async def __aexit__(self, *args): return False
            async def post(self, *args, **kwargs): return EmptyTranscriptResponse()
        original = (settings.GNANI_LIVE_ENABLED, settings.GNANI_ALLOW_PAID_LIVE_CALLS, settings.GNANI_PRISMA_ENABLED, settings.GNANI_API_KEY)
        try:
            settings.GNANI_LIVE_ENABLED = True
            settings.GNANI_ALLOW_PAID_LIVE_CALLS = True
            settings.GNANI_PRISMA_ENABLED = True
            settings.GNANI_API_KEY = "test-only-not-a-real-key"
            with patch("app.services.gnani_voice.httpx.AsyncClient", return_value=FakeClient()):
                result = asyncio.run(DormantGnaniVoiceProvider().speech_to_text(self.valid_wav, "en"))
            self.assertEqual(result.transcript, "")
            self.assertIsNone(result.confidence)
        finally:
            settings.GNANI_LIVE_ENABLED, settings.GNANI_ALLOW_PAID_LIVE_CALLS, settings.GNANI_PRISMA_ENABLED, settings.GNANI_API_KEY = original

    def test_stt_file_upload_endpoint(self):
        """Tests multipart/form-data upload route /api/voice/stt/upload."""
        files = {
            "file": ("recorded.wav", self.valid_wav, "audio/wav")
        }
        data = {"language": "te", "duration_seconds": "1"}
        with patch("app.routers.voice.get_voice_provider", return_value=FakePrismaProvider()):
            res = self.client.post("/api/voice/stt/upload", files=files, data=data)
        self.assertEqual(res.status_code, 200)
        resp_data = res.json()
        self.assertEqual(resp_data["language"], "te")
        self.assertEqual(resp_data["transcript"], "mocked Prisma transcript")
        self.assertEqual(resp_data["provider"], "gnani_live")
        self.assertEqual(resp_data["model"], "prisma-v3.0")

    def test_voice_config_endpoint(self):
        """Verifies /api/voice/config accurately reports provider and credit protection."""
        res = self.client.get("/api/voice/config")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["live_enabled"])
        self.assertTrue(data["credits_protected"])
        self.assertEqual(data["provider"], "gnani_voice_providers_disabled")
        self.assertFalse(data["gemini_stt_enabled"])
        self.assertFalse(data["browser_speech_fallback_active"])
        self.assertIn("Prisma v3.0 is disabled", data["stt_engine"])
        self.assertIn("Timbre v3.0 is disabled", data["tts_engine"])
        self.assertEqual(data["available_voices"], [])
        # Ensure private endpoints are never leaked in public config
        self.assertNotIn("stt_endpoint", data)
        self.assertNotIn("tts_endpoint", data)

    def test_voice_config_reports_only_switches_that_can_activate_a_modality(self):
        original = (settings.GNANI_LIVE_ENABLED, settings.GNANI_PRISMA_ENABLED, settings.GNANI_TIMBRE_ENABLED)
        try:
            settings.GNANI_LIVE_ENABLED = True
            settings.GNANI_PRISMA_ENABLED = True
            settings.GNANI_TIMBRE_ENABLED = False
            data = self.client.get("/api/voice/config").json()
            self.assertTrue(data["prisma_enabled"])
            self.assertFalse(data["timbre_enabled"])
            self.assertIn("Prisma v3.0", data["stt_engine"])
            self.assertIn("Timbre v3.0 is disabled", data["tts_engine"])
            self.assertNotIn("api_key", str(data).lower())
        finally:
            settings.GNANI_LIVE_ENABLED, settings.GNANI_PRISMA_ENABLED, settings.GNANI_TIMBRE_ENABLED = original

    def test_websocket_stt_stream(self):
        """Tests batch streaming with the Prisma provider mocked."""
        with patch("app.routers.voice.get_voice_provider", return_value=FakePrismaProvider()):
            with self.client.websocket_connect("/api/voice/ws/stt?language=hi") as ws:
                chunk = self.valid_wav[:len(self.valid_wav)//2]
                ws.send_bytes(chunk)
                msg1 = ws.receive_json()
                self.assertEqual(msg1["status"], "listening")
                ws.send_bytes(self.valid_wav[len(self.valid_wav)//2:])
                msg2 = ws.receive_json()
                self.assertEqual(msg2["status"], "listening")
                ws.send_text("EOS")
                msg3 = ws.receive_json()
                self.assertEqual(msg3["status"], "completed")
                self.assertEqual(msg3["transcript"], "mocked Prisma transcript")
                self.assertFalse(msg3["is_mock"])

if __name__ == "__main__":
    unittest.main()
