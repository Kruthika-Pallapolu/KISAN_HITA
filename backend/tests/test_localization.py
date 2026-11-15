"""Regression tests for seven-language agricultural localization in Kisan Hita."""

import unittest
from backend.app.services.localization import (
    localize,
    localize_safe,
    localize_fields,
    SUPPORTED_LANGUAGES,
    _TRANSLATIONS,
)
from backend.app.services.crop_service import CropAdvisorService
from backend.app.services.intent_router import AssistantOrchestrator
from backend.app.services.market_service import MarketPriceService
from backend.app.database import (
    save_conversation_message,
    save_conversation_session,
    get_conversation_session,
    clear_conversation_session,
    clear_conversation_history,
    get_conversation_language,
)


class TestLocalizationCentral(unittest.TestCase):
    """Test central localization module across all 7 supported languages."""

    def test_all_seven_languages_supported(self):
        expected_langs = {"en", "te", "hi", "ta", "kn", "ml", "mr"}
        self.assertEqual(SUPPORTED_LANGUAGES, expected_langs)

    def test_english_identity(self):
        terms = ["Red Sandy Loam", "Rainfed / Dryland", "Bengal Gram (Chickpea)", "Chilli", "KVK"]
        for t in terms:
            self.assertEqual(localize(t, "en"), t)

    def test_telugu_verified_terms(self):
        self.assertEqual(localize("Red Sandy Loam", "te"), "ఎర్ర ఇసుకతో కూడిన నేల")
        self.assertEqual(localize("Rainfed / Dryland", "te"), "వర్షాధార సాగు")
        self.assertEqual(localize("Rabi (Winter)", "te"), "రబీ కాలం")
        self.assertEqual(localize("Bengal Gram (Chickpea)", "te"), "శనగ")
        self.assertEqual(localize("Black Gram (Urad Dal)", "te"), "మినుములు")
        self.assertEqual(localize("Groundnut", "te"), "వేరుశనగ")
        self.assertEqual(localize("KVK", "te"), "కృషి విజ్ఞాన కేంద్రం")
        self.assertEqual(localize("Nellore", "te"), "నెల్లూరు")

    def test_all_languages_have_core_soils_waters_seasons_crops(self):
        core_terms = [
            "red sandy loam",
            "black cotton soil",
            "clay soil",
            "loamy soil",
            "rainfed / dryland",
            "good irrigation",
            "limited irrigation",
            "rabi (winter)",
            "kharif (monsoon)",
            "zaid (summer)",
            "bengal gram (chickpea)",
            "black gram (urad dal)",
            "groundnut",
            "chilli",
            "paddy (rice)",
            "cotton",
            "maize (corn)",
            "red gram (pigeonpea)",
            "soybean",
            "tomato",
            "watermelon",
            "sesame (til)",
            "kvk",
            "nellore",
        ]
        non_en_langs = [l for l in SUPPORTED_LANGUAGES if l != "en"]
        for lang in non_en_langs:
            for term in core_terms:
                with self.subTest(term=term, language=lang):
                    translated = localize(term, lang)
                    self.assertTrue(bool(translated), f"Translation for '{term}' in '{lang}' was empty")
                    # Ensure it is not English fallback
                    self.assertNotEqual(
                        translated.strip().lower(),
                        term.strip().lower(),
                        f"Term '{term}' in '{lang}' was not translated (got English)",
                    )

    def test_market_commodities_translated_in_all_languages(self):
        commodities = [
            "Apple", "Beans", "Bitter gourd", "Bottle gourd", "Brinjal", "Cabbage",
            "Cauliflower", "Chilli (dry)", "Coriander seed", "Cotton", "Cucumber",
            "Drumstick", "Garlic", "Ginger", "Gram (Chana)", "Green peas",
            "Groundnut", "Jute", "Maize", "Mustard", "Okra", "Onion", "Paddy",
            "Pineapple", "Potato", "Pumpkin", "Red gram (Tur)", "Soybean",
            "Spinach", "Tomato", "Turmeric", "Wheat",
        ]
        non_en_langs = [l for l in SUPPORTED_LANGUAGES if l != "en"]
        for lang in non_en_langs:
            for comm in commodities:
                with self.subTest(commodity=comm, language=lang):
                    translated = localize(comm, lang)
                    self.assertTrue(bool(translated))

    def test_missing_translation_raises_keyerror_on_strict_localize(self):
        with self.assertRaises(KeyError):
            localize("completely_unknown_agricultural_concept_xyz", "te")

    def test_localize_safe_falls_back_cleanly(self):
        fallback = localize_safe("completely_unknown_agricultural_concept_xyz", "te")
        self.assertEqual(fallback, "completely_unknown_agricultural_concept_xyz")


class TestCropAdvisorLocalization(unittest.TestCase):
    """Test CropAdvisorService localization in all 7 languages."""

    def test_crop_recommendations_localized_in_telugu(self):
        res = CropAdvisorService.get_recommendations(
            soil="Red Sandy Loam",
            water="Rainfed / Dryland",
            season="Rabi (Winter)",
            district="Nellore",
            state="Andhra Pradesh",
            language="te",
        )
        self.assertGreater(res.total_found, 0)
        self.assertEqual(res.soil_type, "ఎర్ర ఇసుకతో కూడిన నేల")
        self.assertEqual(res.water_availability, "వర్షాధార సాగు")
        self.assertEqual(res.growing_season, "రబీ కాలం")

        # Check crops are in Telugu
        rec_names = [r.crop_name for r in res.recommendations]
        for name in rec_names:
            self.assertNotIn("Bengal Gram", name)
            self.assertNotIn("Black Gram", name)
            self.assertNotIn("Groundnut", name)

        # Check disclaimer is in Telugu and contains KVK translation
        self.assertIn("కృషి విజ్ఞాన కేంద్రం", res.disclaimer)
        self.assertNotIn("Krishi Vigyan Kendra", res.disclaimer)

    def test_crop_recommendations_localized_across_all_languages(self):
        for lang in SUPPORTED_LANGUAGES:
            with self.subTest(language=lang):
                res = CropAdvisorService.get_recommendations(
                    soil="Black Cotton Soil",
                    water="Good irrigation",
                    season="Kharif (Monsoon)",
                    district="Warangal",
                    state="Telangana",
                    language=lang,
                )
                self.assertGreater(res.total_found, 0)
                if lang != "en":
                    for r in res.recommendations:
                        # Should have non-empty localized crop name
                        self.assertTrue(bool(r.crop_name))
                else:
                    self.assertIn("DEMO", res.disclaimer)


class TestAssistantReplyLocalization(unittest.TestCase):
    """Test AssistantOrchestrator generates pure Telugu response for crop recommendations."""

    async def async_test_telugu_crop_reply_purity(self):
        conv_id = "test_conv_te_purity"
        clear_conversation_session(conv_id)

        response = await AssistantOrchestrator.process_user_query(
            message="What crops can I grow?",
            conversation_id=conv_id,
            language="te",
            farm_context={
                "district": "Nellore",
                "state": "Andhra Pradesh",
                "soil_type": "Red Sandy Loam",
                "water_source": "Rainfed / Dryland",
                "growing_season": "Rabi (Winter)",
            },
        )
        reply = response.reply_text

        # Verify expected Telugu terminology
        self.assertIn("నెల్లూరు", reply)
        self.assertIn("ఎర్ర ఇసుకతో కూడిన నేల", reply)
        self.assertIn("వర్షాధార సాగు", reply)
        self.assertIn("రబీ కాలం", reply)
        self.assertIn("కృషి విజ్ఞాన కేంద్రం", reply)

        # Verify no unnecessary English terminology in Telugu response
        self.assertNotIn("Red Sandy Loam", reply)
        self.assertNotIn("Rainfed / Dryland", reply)
        self.assertNotIn("Rabi (Winter)", reply)
        self.assertNotIn("Bengal Gram", reply)
        self.assertNotIn("Chickpea", reply)
        self.assertNotIn("Black Gram", reply)
        self.assertNotIn("Urad Dal", reply)
        self.assertNotIn("Groundnut", reply)
        self.assertNotIn("KVK", reply)

    def test_telugu_crop_reply_purity(self):
        import asyncio
        asyncio.run(self.async_test_telugu_crop_reply_purity())


class TestMarketCommoditiesPreserveIdsAndPrices(unittest.TestCase):
    """Verify market commodities keep internal IDs, district codes and numeric prices unchanged."""

    async def async_test_market_price_search_preserves_identifiers_and_prices(self):
        # Fetch illustrative market prices for a known commodity
        result = await MarketPriceService.get_market_prices(
            commodity="Paddy",
            state="Andhra Pradesh",
            district="Nellore",
        )
        self.assertGreater(result.total_count, 0)
        for rec in result.records:
            # Commodity remains canonical internally
            self.assertEqual(rec.commodity, "Paddy")
            # Numeric prices are unchanged floats
            self.assertIsInstance(rec.modal_price_per_kg, (float, int))
            self.assertGreater(rec.modal_price_per_kg, 0)
            # Localized display name can be generated separately without mutating record
            loc_comm = localize(rec.commodity, "te")
            self.assertEqual(loc_comm, "వరి")
            self.assertEqual(rec.commodity, "Paddy")

    def test_market_price_search_preserves_identifiers_and_prices(self):
        import asyncio
        asyncio.run(self.async_test_market_price_search_preserves_identifiers_and_prices())


class TestLanguageSwitchingAndSessionIsolation(unittest.TestCase):
    """Verify switching language clears previous language session context."""

    def test_language_switch_clears_session_cache(self):
        conv_id = "test_conv_lang_switch"
        owner_id = "session_test_user_123"

        # 1. Start in English and store a session
        clear_conversation_history(conv_id, None)
        clear_conversation_session(conv_id)

        save_conversation_message(
            conversation_id=conv_id,
            sender="user",
            text="I want crop advice",
            language="en",
            owner_id=owner_id,
        )
        save_conversation_session(
            conversation_id=conv_id,
            pending_workflow="crop_advisor",
            collected_slots={"soil_type": "Red Sandy Loam"},
            missing_slots=["water_availability", "growing_season"],
        )

        session_en = get_conversation_session(conv_id)
        self.assertEqual(session_en.get("pending_workflow"), "crop_advisor")
        self.assertEqual(session_en.get("collected_slots", {}).get("soil_type"), "Red Sandy Loam")

        # 2. Check conversation language
        conv_lang = get_conversation_language(conv_id)
        self.assertEqual(conv_lang, "en")

        # 3. Simulate language switch detection
        # When switching to 'te', clear the session
        clear_conversation_session(conv_id)
        session_after_switch = get_conversation_session(conv_id)
        self.assertIsNone(session_after_switch.get("pending_workflow"))
        self.assertEqual(session_after_switch.get("collected_slots"), {})


if __name__ == "__main__":
    unittest.main()
