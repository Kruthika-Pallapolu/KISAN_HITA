"""Central agricultural terminology localisation.

Provides term-to-translation mappings for the seven supported languages:
- en (English) - identity mapping
- te (Telugu)
- hi (Hindi)
- ta (Tamil)
- kn (Kannada)
- ml (Malayalam)
- mr (Marathi)

Only user-visible display terms are included; internal identifiers, API keys,
numeric values, and source metadata are left untouched.
"""

from __future__ import annotations

import re
from typing import Dict, Tuple, List, Any, Optional

# Supported language codes
SUPPORTED_LANGUAGES = {"en", "te", "hi", "ta", "kn", "ml", "mr"}

# ---------------------------------------------------------------------------
# Term translation table
# ---------------------------------------------------------------------------
# Canonical key is lower-cased and stripped.
# ---------------------------------------------------------------------------

_TRANSLATIONS: Dict[Tuple[str, str], str] = {
    # ---------------- Soil types ----------------
    ("red sandy loam", "te"): "ఎర్ర ఇసుకతో కూడిన నేల",
    ("red sandy loam", "hi"): "लाल रेतीली दोमट मिट्टी",
    ("red sandy loam", "ta"): "செம்மண் மணல் கலந்த மண்",
    ("red sandy loam", "kn"): "ಕೆಂಪು ಮರಳು ಮಿಶ್ರಿತ ಮಣ್ಣು",
    ("red sandy loam", "ml"): "ചുവന്ന മണൽ കലർന്ന മണ്ണ്",
    ("red sandy loam", "mr"): "लाल वाळूमिश्रित पोयटा माती",

    ("black cotton soil", "te"): "నల్లరేగడి నేల",
    ("black cotton soil", "hi"): "काली कपास मिट्टी",
    ("black cotton soil", "ta"): "கரிசல் மண்",
    ("black cotton soil", "kn"): "ಕಪ್ಪು ಹತ್ತಿ ಮಣ್ಣು",
    ("black cotton soil", "ml"): "കറുത്ത പരുത്തി മണ്ണ്",
    ("black cotton soil", "mr"): "काळी कापूस माती",

    ("black soil", "te"): "నల్లరేగడి నేల",
    ("black soil", "hi"): "काली मिट्टी",
    ("black soil", "ta"): "கரிசல் மண்",
    ("black soil", "kn"): "ಕಪ್ಪು ಮಣ್ಣು",
    ("black soil", "ml"): "കറുത്ത മണ്ണ്",
    ("black soil", "mr"): "काळी माती",

    ("clay soil", "te"): "బంకమట్టి నేల",
    ("clay soil", "hi"): "चिकनी मिट्टी",
    ("clay soil", "ta"): "களிமண்",
    ("clay soil", "kn"): "ಜೇಡಿ ಮಣ್ಣು",
    ("clay soil", "ml"): "കളിമണ്ണ്",
    ("clay soil", "mr"): "काळी चिकनमाती",

    ("heavy loamy soil", "te"): "భారీ ఒండ్రు నేల",
    ("heavy loamy soil", "hi"): "भारी दोमट मिट्टी",
    ("heavy loamy soil", "ta"): "அடர்ந்த வண்டல் மண்",
    ("heavy loamy soil", "kn"): "ಭಾರವಾದ ಗೋಡು ಮಣ್ಣು",
    ("heavy loamy soil", "ml"): "കനത്ത എക്കൽ മണ്ണ്",
    ("heavy loamy soil", "mr"): "भारी पोयटा माती",

    ("loamy soil", "te"): "ఒండ్రు నేల",
    ("loamy soil", "hi"): "दोमट मिट्टी",
    ("loamy soil", "ta"): "வண்டல் மண்",
    ("loamy soil", "kn"): "ಗೋಡು ಮಣ್ಣು",
    ("loamy soil", "ml"): "എക്കൽ മണ്ണ്",
    ("loamy soil", "mr"): "पोयटा माती",

    ("deep loamy soil", "te"): "లోతైన ఒండ్రు నేల",
    ("deep loamy soil", "hi"): "गहरी दोमट मिट्टी",
    ("deep loamy soil", "ta"): "ஆழமான வண்டல் மண்",
    ("deep loamy soil", "kn"): "ಆಳವಾದ ಗೋಡು ಮಣ್ಣು",
    ("deep loamy soil", "ml"): "ആഴമുള്ള എക്കൽ മണ്ണ്",
    ("deep loamy soil", "mr"): "खोल पोयटा माती",

    ("red soil", "te"): "ఎర్ర నేల",
    ("red soil", "hi"): "लाल मिट्टी",
    ("red soil", "ta"): "செம்மண்",
    ("red soil", "kn"): "ಕೆಂಪು ಮಣ್ಣು",
    ("red soil", "ml"): "ചുവന്ന മണ്ണ്",
    ("red soil", "mr"): "लाल माती",

    ("sandy soil", "te"): "ఇసుక నేల",
    ("sandy soil", "hi"): "रेतीली मिट्टी",
    ("sandy soil", "ta"): "மணல் மண்",
    ("sandy soil", "kn"): "ಮರಳು ಮಣ್ಣು",
    ("sandy soil", "ml"): "മണൽ മണ്ണ്",
    ("sandy soil", "mr"): "वाळूची माती",

    # ---------------- Water conditions ----------------
    ("rainfed / dryland", "te"): "వర్షాధార సాగు",
    ("rainfed / dryland", "hi"): "वर्षा आधारित / शुष्क भूमि",
    ("rainfed / dryland", "ta"): "மானாவாரி / வறண்ட நிலம்",
    ("rainfed / dryland", "kn"): "ಮಳೆಯಾಶ್ರಿತ / ಒಣಭೂಮಿ",
    ("rainfed / dryland", "ml"): "മഴയെ ആശ്രയിച്ചുള്ള കൃഷി",
    ("rainfed / dryland", "mr"): "कोरडवाहू / पावसावर आधारित",

    ("rainfed", "te"): "వర్షాధార సాగు",
    ("rainfed", "hi"): "वर्षा आधारित",
    ("rainfed", "ta"): "மானாவாரி",
    ("rainfed", "kn"): "ಮಳೆಯಾಶ್ರಿತ",
    ("rainfed", "ml"): "മഴയെ ആശ്രയിച്ചുള്ള",
    ("rainfed", "mr"): "पावसावर आधारित",

    ("dryland", "te"): "మెట్ట సాగు",
    ("dryland", "hi"): "शुष्क भूमि",
    ("dryland", "ta"): "வறண்ட நிலம்",
    ("dryland", "kn"): "ಒಣಭೂಮಿ",
    ("dryland", "ml"): "ഉണങ്ങിയ നിലം",
    ("dryland", "mr"): "कोरडवाहू जमीन",

    ("good irrigation", "te"): "సమృద్ధిగా నీటి సదుపాయం",
    ("good irrigation", "hi"): "उत्तम सिंचाई",
    ("good irrigation", "ta"): "நல்ல பாசன வசதி",
    ("good irrigation", "kn"): "ಉತ್ತಮ ನೀರಾವರಿ",
    ("good irrigation", "ml"): "നല്ല ജലസേചനം",
    ("good irrigation", "mr"): "उत्कृष्ट सिंचन",

    ("limited irrigation", "te"): "పరిమిత నీటి సదుపాయం",
    ("limited irrigation", "hi"): "सीमित सिंचाई",
    ("limited irrigation", "ta"): "வரையறுக்கப்பட்ட பாசனம்",
    ("limited irrigation", "kn"): "ಮಿತ ನೀರಾವರಿ",
    ("limited irrigation", "ml"): "പരിമിതമായ ജലസേചനം",
    ("limited irrigation", "mr"): "मर्यादित सिंचन",

    ("rain-dependent", "te"): "వర్షాధారితం",
    ("rain-dependent", "hi"): "बारिश पर निर्भर",
    ("rain-dependent", "ta"): "மழை சார்ந்த",
    ("rain-dependent", "kn"): "ಮಳೆ ಆಶ್ರಿತ",
    ("rain-dependent", "ml"): "മഴയെ ആശ്രയിച്ചുള്ളത്",
    ("rain-dependent", "mr"): "पावसावर अवलंबून",

    # ---------------- Seasons ----------------
    ("rabi (winter)", "te"): "రబీ కాలం",
    ("rabi (winter)", "hi"): "रबी (सर्दियों का मौसम)",
    ("rabi (winter)", "ta"): "ரபி பருவம் (குளிர்காலம்)",
    ("rabi (winter)", "kn"): "ರಬಿ (ಚಳಿಗಾಲ)",
    ("rabi (winter)", "ml"): "റബി (ശീതകാലം)",
    ("rabi (winter)", "mr"): "रब्बी (हिवाळा)",

    ("rabi", "te"): "రబీ కాలం",
    ("rabi", "hi"): "रबी",
    ("rabi", "ta"): "ரபி",
    ("rabi", "kn"): "ರಬಿ",
    ("rabi", "ml"): "റബി",
    ("rabi", "mr"): "रब्बी",

    ("winter", "te"): "శీతాకాలం",
    ("winter", "hi"): "सर्दियों का मौसम",
    ("winter", "ta"): "குளிர்காலம்",
    ("winter", "kn"): "ಚಳಿಗಾಲ",
    ("winter", "ml"): "ശീതകാലം",
    ("winter", "mr"): "हिवाळा",

    ("kharif (monsoon)", "te"): "ఖరీఫ్ కాలం",
    ("kharif (monsoon)", "hi"): "खरीफ (मानसून का मौसम)",
    ("kharif (monsoon)", "ta"): "காரீப் பருவம் (மழைக்காலம்)",
    ("kharif (monsoon)", "kn"): "ಖಾರೀಫ್ (ಮುಂಗಾರು)",
    ("kharif (monsoon)", "ml"): "ഖാരിഫ് (മഴക്കാലം)",
    ("kharif (monsoon)", "mr"): "खरीप (पावसाळा)",

    ("kharif", "te"): "ఖరీఫ్ కాలం",
    ("kharif", "hi"): "खरीफ",
    ("kharif", "ta"): "காரீப்",
    ("kharif", "kn"): "ಖಾರೀಫ್",
    ("kharif", "ml"): "ഖാരിഫ്",
    ("kharif", "mr"): "खरीप",

    ("monsoon", "te"): "వర్షాకాలం",
    ("monsoon", "hi"): "मानसून",
    ("monsoon", "ta"): "மழைக்காலம்",
    ("monsoon", "kn"): "ಮುಂಗಾರು",
    ("monsoon", "ml"): "മഴക്കാലം",
    ("monsoon", "mr"): "पावसाळा",

    ("zaid (summer)", "te"): "వేసవి (జైద్) కాలం",
    ("zaid (summer)", "hi"): "जायद (गर्मी का मौसम)",
    ("zaid (summer)", "ta"): "கோடை பருவம் (ஜைத்)",
    ("zaid (summer)", "kn"): "ಬೇಸಿಗೆ (ಜೈದ್)",
    ("zaid (summer)", "ml"): "വേനൽക്കാലം (സെയ്ദ്)",
    ("zaid (summer)", "mr"): "उन्हाळी (झायद)",

    ("summer (zaid)", "te"): "వేసవి (జైద్) కాలం",
    ("summer (zaid)", "hi"): "जायद (गर्मी का मौसम)",
    ("summer (zaid)", "ta"): "கோடை பருவம் (ஜைத்)",
    ("summer (zaid)", "kn"): "ಬೇಸಿಗೆ (ಜೈದ್)",
    ("summer (zaid)", "ml"): "വേനൽക്കാലം (സെയ്ദ്)",
    ("summer (zaid)", "mr"): "उन्हाळी (झायद)",

    ("zaid", "te"): "జైద్ కాలం",
    ("zaid", "hi"): "जायद",
    ("zaid", "ta"): "ஜைத்",
    ("zaid", "kn"): "ಜೈದ್",
    ("zaid", "ml"): "സെയ്ദ്",
    ("zaid", "mr"): "झायद",

    ("summer", "te"): "వేసవి కాలం",
    ("summer", "hi"): "गर्मी का मौसम",
    ("summer", "ta"): "கோடைக்காலம்",
    ("summer", "kn"): "ಬೇಸಿಗೆ ಕಾಲ",
    ("summer", "ml"): "വേനൽക്കാലം",
    ("summer", "mr"): "उन्हाळा",

    ("rabi / rice fallow", "te"): "రబీ / వరి మాగాణి",
    ("rabi / rice fallow", "hi"): "रबी / धान परती",
    ("rabi / rice fallow", "ta"): "ரபி / நெல் தரிசு",
    ("rabi / rice fallow", "kn"): "ರಬಿ / ಭತ್ತದ ಪಾಳು ಭೂಮಿ",
    ("rabi / rice fallow", "ml"): "റബി / നെൽപ്പാട തരിശ്",
    ("rabi / rice fallow", "mr"): "रब्बी / भात पड जमीन",

    ("kharif & rabi", "te"): "ఖరీఫ్ మరియు రబీ",
    ("kharif & rabi", "hi"): "खरीफ और रबी",
    ("kharif & rabi", "ta"): "காரீப் மற்றும் ரபி",
    ("kharif & rabi", "kn"): "ಖಾರೀಫ್ ಮತ್ತು ರಬಿ",
    ("kharif & rabi", "ml"): "ഖാരിഫും റബിയും",
    ("kharif & rabi", "mr"): "खरीप आणि रब्बी",

    ("rabi & kharif", "te"): "రబీ మరియు ఖరీఫ్",
    ("rabi & kharif", "hi"): "रबी और खरीफ",
    ("rabi & kharif", "ta"): "ரபி மற்றும் காரீப்",
    ("rabi & kharif", "kn"): "ರಬಿ ಮತ್ತು ಖಾರೀಫ್",
    ("rabi & kharif", "ml"): "റബിയും ഖാരിഫും",
    ("rabi & kharif", "mr"): "रब्बी आणि खरीप",

    ("summer (zaid) & rabi", "te"): "వేసవి (జైద్) మరియు రబీ",
    ("summer (zaid) & rabi", "hi"): "जायद और रबी",
    ("summer (zaid) & rabi", "ta"): "ஜைத் மற்றும் ரபி",
    ("summer (zaid) & rabi", "kn"): "ಜೈದ್ ಮತ್ತು ರಬಿ",
    ("summer (zaid) & rabi", "ml"): "സെയ്ദും റബിയും",
    ("summer (zaid) & rabi", "mr"): "झायद आणि रब्बी",

    # ---------------- Crops & Commodities ----------------
    ("bengal gram (chickpea)", "te"): "శనగ",
    ("bengal gram (chickpea)", "hi"): "चना",
    ("bengal gram (chickpea)", "ta"): "கொண்டைக்கடலை",
    ("bengal gram (chickpea)", "kn"): "ಕಡಲೆ",
    ("bengal gram (chickpea)", "ml"): "കടല",
    ("bengal gram (chickpea)", "mr"): "हरभरा",

    ("bengal gram", "te"): "శనగ",
    ("bengal gram", "hi"): "चना",
    ("bengal gram", "ta"): "கொண்டைக்கடலை",
    ("bengal gram", "kn"): "ಕಡಲೆ",
    ("bengal gram", "ml"): "കടല",
    ("bengal gram", "mr"): "हरभरा",

    ("chickpea", "te"): "శనగ",
    ("chickpea", "hi"): "चना",
    ("chickpea", "ta"): "கொண்டைக்கடலை",
    ("chickpea", "kn"): "ಕಡಲೆ",
    ("chickpea", "ml"): "കടല",
    ("chickpea", "mr"): "हरभरा",

    ("gram (chana)", "te"): "శనగ",
    ("gram (chana)", "hi"): "चना",
    ("gram (chana)", "ta"): "கொண்டைக்கடலை",
    ("gram (chana)", "kn"): "ಕಡಲೆ",
    ("gram (chana)", "ml"): "കടല",
    ("gram (chana)", "mr"): "हरभरा",

    ("black gram (urad dal)", "te"): "మినుములు",
    ("black gram (urad dal)", "hi"): "उड़द",
    ("black gram (urad dal)", "ta"): "உளுந்து",
    ("black gram (urad dal)", "kn"): "ಉದ್ದು",
    ("black gram (urad dal)", "ml"): "ഉഴുന്ന്",
    ("black gram (urad dal)", "mr"): "उडीद",

    ("black gram", "te"): "మినుములు",
    ("black gram", "hi"): "उड़द",
    ("black gram", "ta"): "உளுந்து",
    ("black gram", "kn"): "ಉದ್ದು",
    ("black gram", "ml"): "ഉഴുന്ന്",
    ("black gram", "mr"): "उडीद",

    ("urad dal", "te"): "మినుములు",
    ("urad dal", "hi"): "उड़द दाल",
    ("urad dal", "ta"): "உளுந்து",
    ("urad dal", "kn"): "ಉದ್ದಿನ ಬೇಳೆ",
    ("urad dal", "ml"): "ഉഴുന്ന് പരിപ്പ്",
    ("urad dal", "mr"): "उडीद डाळ",

    ("groundnut", "te"): "వేరుశనగ",
    ("groundnut", "hi"): "मूंगफली",
    ("groundnut", "ta"): "நிலக்கடலை",
    ("groundnut", "kn"): "ಕಡಲೆಕಾಯಿ",
    ("groundnut", "ml"): "നിലക്കടല",
    ("groundnut", "mr"): "भुईमूग",

    ("groundnut (peanut)", "te"): "వేరుశనగ",
    ("groundnut (peanut)", "hi"): "मूंगफली",
    ("groundnut (peanut)", "ta"): "நிலக்கடலை",
    ("groundnut (peanut)", "kn"): "ಕಡಲೆಕಾಯಿ",
    ("groundnut (peanut)", "ml"): "നിലക്കടല",
    ("groundnut (peanut)", "mr"): "भुईमूग",

    ("peanut", "te"): "వేరుశనగ",
    ("peanut", "hi"): "मूंगफली",
    ("peanut", "ta"): "நிலக்கடலை",
    ("peanut", "kn"): "ಕಡಲೆಕಾಯಿ",
    ("peanut", "ml"): "നിലക്കടല",
    ("peanut", "mr"): "भुईमूग",

    ("paddy (rice)", "te"): "వరి",
    ("paddy (rice)", "hi"): "धान / चावल",
    ("paddy (rice)", "ta"): "நெல்",
    ("paddy (rice)", "kn"): "ಭತ್ತ",
    ("paddy (rice)", "ml"): "നെല്ല്",
    ("paddy (rice)", "mr"): "भात / धान",

    ("paddy", "te"): "వరి",
    ("paddy", "hi"): "धान",
    ("paddy", "ta"): "நெல்",
    ("paddy", "kn"): "ಭತ್ತ",
    ("paddy", "ml"): "നെല്ല്",
    ("paddy", "mr"): "भात",

    ("rice", "te"): "బియ్యం",
    ("rice", "hi"): "चावल",
    ("rice", "ta"): "அரிசி",
    ("rice", "kn"): "ಅಕ್ಕಿ",
    ("rice", "ml"): "അരി",
    ("rice", "mr"): "तांदूळ",

    ("cotton", "te"): "పత్తి",
    ("cotton", "hi"): "कपास",
    ("cotton", "ta"): "பருத்தி",
    ("cotton", "kn"): "ಹತ್ತಿ",
    ("cotton", "ml"): "പരുത്തി",
    ("cotton", "mr"): "कापूस",

    ("cotton (bt / desi)", "te"): "పత్తి",
    ("cotton (bt / desi)", "hi"): "कपास",
    ("cotton (bt / desi)", "ta"): "பருத்தி",
    ("cotton (bt / desi)", "kn"): "ಹತ್ತಿ",
    ("cotton (bt / desi)", "ml"): "പരുത്തി",
    ("cotton (bt / desi)", "mr"): "कापूस",

    ("chilli", "te"): "మిరప",
    ("chilli", "hi"): "मिर्च",
    ("chilli", "ta"): "மிளகாய்",
    ("chilli", "kn"): "ಮೆಣಸಿನಕಾಯಿ",
    ("chilli", "ml"): "മുളക്",
    ("chilli", "mr"): "मिरची",

    ("chilli (dry)", "te"): "ఎండు మిర్చి",
    ("chilli (dry)", "hi"): "सूखी मिर्च",
    ("chilli (dry)", "ta"): "வற்றல் மிளகாய்",
    ("chilli (dry)", "kn"): "ಒಣ ಮೆಣಸಿನಕಾಯಿ",
    ("chilli (dry)", "ml"): "വറ്റൽ മുളക്",
    ("chilli (dry)", "mr"): "सुकी मिरची",

    ("maize (corn)", "te"): "మొక్కజొన్న",
    ("maize (corn)", "hi"): "मक्का",
    ("maize (corn)", "ta"): "மக்காச்சோளம்",
    ("maize (corn)", "kn"): "ಮೆಕ್ಕೆಜೋಳ",
    ("maize (corn)", "ml"): "മക്കച്ചോളം",
    ("maize (corn)", "mr"): "मका",

    ("maize", "te"): "మొక్కజొన్న",
    ("maize", "hi"): "मक्का",
    ("maize", "ta"): "மக்காச்சோளம்",
    ("maize", "kn"): "ಮೆಕ್ಕೆಜೋಳ",
    ("maize", "ml"): "മക്കച്ചോളം",
    ("maize", "mr"): "मका",

    ("corn", "te"): "మొక్కజొన్న",
    ("corn", "hi"): "मक्का",
    ("corn", "ta"): "மக்காச்சோளம்",
    ("corn", "kn"): "ಮೆಕ್ಕೆಜೋಳ",
    ("corn", "ml"): "മക്കച്ചോളം",
    ("corn", "mr"): "मका",

    ("red gram (pigeonpea)", "te"): "కందులు",
    ("red gram (pigeonpea)", "hi"): "अरहर / तुअर",
    ("red gram (pigeonpea)", "ta"): "துவரை",
    ("red gram (pigeonpea)", "kn"): "ತೊಗರಿ",
    ("red gram (pigeonpea)", "ml"): "തുവര",
    ("red gram (pigeonpea)", "mr"): "तूर",

    ("red gram", "te"): "కందులు",
    ("red gram", "hi"): "अरहर",
    ("red gram", "ta"): "துவரை",
    ("red gram", "kn"): "ತೊಗರಿ",
    ("red gram", "ml"): "തുവര",
    ("red gram", "mr"): "तूर",

    ("red gram (tur)", "te"): "కందులు",
    ("red gram (tur)", "hi"): "अरहर / तुअर",
    ("red gram (tur)", "ta"): "துவரை",
    ("red gram (tur)", "kn"): "ತೊಗರಿ",
    ("red gram (tur)", "ml"): "തുവര",
    ("red gram (tur)", "mr"): "तूर",

    ("pigeonpea", "te"): "కందులు",
    ("pigeonpea", "hi"): "अरहर",
    ("pigeonpea", "ta"): "துவரை",
    ("pigeonpea", "kn"): "ತೊಗರಿ",
    ("pigeonpea", "ml"): "തുവര",
    ("pigeonpea", "mr"): "तूर",

    ("soybean", "te"): "సోయాబీన్",
    ("soybean", "hi"): "सोयाबीन",
    ("soybean", "ta"): "சோயாபீன்",
    ("soybean", "kn"): "ಸೋಯಾಬೀನ್",
    ("soybean", "ml"): "സോയാബീൻ",
    ("soybean", "mr"): "सोयाबीन",

    ("tomato", "te"): "టమాటా",
    ("tomato", "hi"): "टमाटर",
    ("tomato", "ta"): "தக்காளி",
    ("tomato", "kn"): "ಟೊಮೆಟೊ",
    ("tomato", "ml"): "തക്കാളി",
    ("tomato", "mr"): "टोमॅटो",

    ("watermelon", "te"): "పుచ్చకాయ",
    ("watermelon", "hi"): "तरबूज",
    ("watermelon", "ta"): "தர்பூசணி",
    ("watermelon", "kn"): "ಕಲ್ಲಂಗಡಿ",
    ("watermelon", "ml"): "തണ്ണിമത്തൻ",
    ("watermelon", "mr"): "कलिंगड",

    ("sesame (til)", "te"): "నువ్వులు",
    ("sesame (til)", "hi"): "तिल",
    ("sesame (til)", "ta"): "எள்",
    ("sesame (til)", "kn"): "ಎಳ್ಳು",
    ("sesame (til)", "ml"): "എള്ള്",
    ("sesame (til)", "mr"): "तीळ",

    ("sesame", "te"): "నువ్వులు",
    ("sesame", "hi"): "तिल",
    ("sesame", "ta"): "எள்",
    ("sesame", "kn"): "ಎಳ್ಳು",
    ("sesame", "ml"): "എള്ള്",
    ("sesame", "mr"): "तीळ",

    ("onion", "te"): "ఉల్లిపాయ",
    ("onion", "hi"): "प्याज",
    ("onion", "ta"): "வெங்காயம்",
    ("onion", "kn"): "ಈರುಳ್ಳಿ",
    ("onion", "ml"): "സവാള",
    ("onion", "mr"): "कांदा",

    ("wheat", "te"): "గోధుమ",
    ("wheat", "hi"): "गेहूं",
    ("wheat", "ta"): "கோதுமை",
    ("wheat", "kn"): "ಗೋಧಿ",
    ("wheat", "ml"): "ഗോതമ്പ്",
    ("wheat", "mr"): "गहू",

    ("potato", "te"): "బంగాళాదుంప",
    ("potato", "hi"): "आलू",
    ("potato", "ta"): "உருளைக்கிழங்கு",
    ("potato", "kn"): "ಆಲೂಗಡ್ಡೆ",
    ("potato", "ml"): "ഉരുളക്കിഴങ്ങ്",
    ("potato", "mr"): "बटाटा",

    ("cabbage", "te"): "క్యాబేజీ",
    ("cabbage", "hi"): "पत्तागोभी",
    ("cabbage", "ta"): "முட்டைக்கோஸ்",
    ("cabbage", "kn"): "ಎಲೆಕೋಸು",
    ("cabbage", "ml"): "കാബേജ്",
    ("cabbage", "mr"): "कोबी",

    ("cauliflower", "te"): "కాలీఫ్లవర్",
    ("cauliflower", "hi"): "फूलगोभी",
    ("cauliflower", "ta"): "காலிஃபிளவர்",
    ("cauliflower", "kn"): "ಹೂಕೋಸು",
    ("cauliflower", "ml"): "കോളിഫ്ലവർ",
    ("cauliflower", "mr"): "फ्लॉवर",

    ("mustard", "te"): "ఆవాలు",
    ("mustard", "hi"): "सरसों",
    ("mustard", "ta"): "கடுகு",
    ("mustard", "kn"): "ಸಾಸಿವೆ",
    ("mustard", "ml"): "കടുക്",
    ("mustard", "mr"): "मोहरी",

    ("ginger", "te"): "అల్లం",
    ("ginger", "hi"): "अदरक",
    ("ginger", "ta"): "இஞ்சி",
    ("ginger", "kn"): "ಶುಂಠಿ",
    ("ginger", "ml"): "ഇഞ്ചി",
    ("ginger", "mr"): "आले",

    ("garlic", "te"): "వెల్లుల్లి",
    ("garlic", "hi"): "लहसुन",
    ("garlic", "ta"): "பூண்டு",
    ("garlic", "kn"): "ಬೆಳ್ಳುಳ್ಳಿ",
    ("garlic", "ml"): "വെളുത്തുള്ളി",
    ("garlic", "mr"): "लसूण",

    ("apple", "te"): "యాపిల్",
    ("apple", "hi"): "सेब",
    ("apple", "ta"): "ஆப்பிள்",
    ("apple", "kn"): "ಸೇಬು",
    ("apple", "ml"): "ആപ്പിൾ",
    ("apple", "mr"): "सफरचंद",

    ("green peas", "te"): "పచ్చి బఠాణీలు",
    ("green peas", "hi"): "हरी मटर",
    ("green peas", "ta"): "பச்சை பட்டாணி",
    ("green peas", "kn"): "ಹಸಿರು ಬಟಾಣಿ",
    ("green peas", "ml"): "പച്ചപ്പട്ടാണി",
    ("green peas", "mr"): "हिरवे वाटाणे",

    ("green gram", "te"): "పెసలు",
    ("green gram", "hi"): "मूंग",
    ("green gram", "ta"): "பாசிப்பயறு",
    ("green gram", "kn"): "ಹೆಸರುಕಾಳು",
    ("green gram", "ml"): "ചെറുപയർ",
    ("green gram", "mr"): "मूग",

    ("coriander seed", "te"): "ధనియాలు",
    ("coriander seed", "hi"): "धनिया बीज",
    ("coriander seed", "ta"): "கொத்தமல்லி விதை",
    ("coriander seed", "kn"): "ಕೊತ್ತಂಬರಿ ಬೀಜ",
    ("coriander seed", "ml"): "മല്ലി",
    ("coriander seed", "mr"): "धने",

    ("jute", "te"): "జనపనార",
    ("jute", "hi"): "जूट / पटसन",
    ("jute", "ta"): "சணல்",
    ("jute", "kn"): "ಸೆಣಬು",
    ("jute", "ml"): "ചണം",
    ("jute", "mr"): "ताग",

    ("pineapple", "te"): "అనాసపండు",
    ("pineapple", "hi"): "अनानास",
    ("pineapple", "ta"): "அன்னாசிப்பழம்",
    ("pineapple", "kn"): "ಅನಾನಸ್",
    ("pineapple", "ml"): "കൈതച്ചക്ക",
    ("pineapple", "mr"): "अननस",

    ("turmeric", "te"): "పసుపు",
    ("turmeric", "hi"): "हल्दी",
    ("turmeric", "ta"): "மஞ்சள்",
    ("turmeric", "kn"): "ಅರಿಶಿನ",
    ("turmeric", "ml"): "മഞ്ഞൾ",
    ("turmeric", "mr"): "हळद",

    ("brinjal", "te"): "వంకాయ",
    ("brinjal", "hi"): "बैंगन",
    ("brinjal", "ta"): "கத்தரிக்காய்",
    ("brinjal", "kn"): "ಬದನೆಕಾಯಿ",
    ("brinjal", "ml"): "വഴുതനങ്ങ",
    ("brinjal", "mr"): "वांगी",

    ("okra", "te"): "బెండకాయ",
    ("okra", "hi"): "भिंडी",
    ("okra", "ta"): "வெண்டைக்காய்",
    ("okra", "kn"): "ಬೆಂಡೆಕಾಯಿ",
    ("okra", "ml"): "വെണ്ടയ്ക്ക",
    ("okra", "mr"): "भेंडी",

    ("bottle gourd", "te"): "సొరకాయ",
    ("bottle gourd", "hi"): "लौकी",
    ("bottle gourd", "ta"): "சுரைக்காய்",
    ("bottle gourd", "kn"): "ಸೋರೆಕಾಯಿ",
    ("bottle gourd", "ml"): "ചുരയ്ക്ക",
    ("bottle gourd", "mr"): "दुधी भोपळा",

    ("bitter gourd", "te"): "కాకరకాయ",
    ("bitter gourd", "hi"): "करेला",
    ("bitter gourd", "ta"): "பாகற்காய்",
    ("bitter gourd", "kn"): "ಹಾಗಲಕಾಯಿ",
    ("bitter gourd", "ml"): "കയ്പക്ക",
    ("bitter gourd", "mr"): "कारले",

    ("cucumber", "te"): "దోసకాయ",
    ("cucumber", "hi"): "खीरा",
    ("cucumber", "ta"): "வெள்ளரிக்காய்",
    ("cucumber", "kn"): "ಸೌತೆಕಾಯಿ",
    ("cucumber", "ml"): "വെള്ളരിക്ക",
    ("cucumber", "mr"): "काकडी",

    ("pumpkin", "te"): "గుమ్మడికాయ",
    ("pumpkin", "hi"): "कद्दू",
    ("pumpkin", "ta"): "பூசணிக்காய்",
    ("pumpkin", "kn"): "ಕುಂಬಳಕಾಯಿ",
    ("pumpkin", "ml"): "മത്തങ്ങ",
    ("pumpkin", "mr"): "भोपळा",

    ("spinach", "te"): "పాలకూర",
    ("spinach", "hi"): "पालक",
    ("spinach", "ta"): "பசலைக்கீரை",
    ("spinach", "kn"): "ಪಾಲಕ್ ಸೊಪ್ಪು",
    ("spinach", "ml"): "ചീര",
    ("spinach", "mr"): "पालक",

    ("beans", "te"): "చిక్కుడు",
    ("beans", "hi"): "फलियां / बीन्स",
    ("beans", "ta"): "பீன்ஸ்",
    ("beans", "kn"): "ಹುರುಳಿಕಾಯಿ",
    ("beans", "ml"): "പയർ",
    ("beans", "mr"): "घेवडा / फरसबी",

    ("drumstick", "te"): "మునగకాయ",
    ("drumstick", "hi"): "सहजन",
    ("drumstick", "ta"): "முருங்கைக்காய்",
    ("drumstick", "kn"): "ನುಗ್ಗೆಕಾಯಿ",
    ("drumstick", "ml"): "മുരിങ്ങക്കായ",
    ("drumstick", "mr"): "शेवगा",

    # ---------------- Agricultural Terms ----------------
    ("kvk", "te"): "కృషి విజ్ఞాన కేంద్రం",
    ("kvk", "hi"): "कृषि विज्ञान केंद्र",
    ("kvk", "ta"): "வேளாண் அறிவியல் மையம்",
    ("kvk", "kn"): "ಕೃಷಿ ವಿಜ್ಞಾನ ಕೇಂದ್ರ",
    ("kvk", "ml"): "കൃഷി വിജ്ഞാന കേന്ദ്രം",
    ("kvk", "mr"): "कृषी विज्ञान केंद्र",

    ("krishi vigyan kendra", "te"): "కృషి విజ్ఞాన కేంద్రం",
    ("krishi vigyan kendra", "hi"): "कृषि विज्ञान केंद्र",
    ("krishi vigyan kendra", "ta"): "வேளாண் அறிவியல் மையம்",
    ("krishi vigyan kendra", "kn"): "ಕೃಷಿ ವಿಜ್ಞಾನ ಕೇಂದ್ರ",
    ("krishi vigyan kendra", "ml"): "കൃഷി വിജ്ഞാന കേന്ദ്രം",
    ("krishi vigyan kendra", "mr"): "कृषी विज्ञान केंद्र",

    ("mandal agriculture officer", "te"): "మండల వ్యవసాయ అధికారి",
    ("mandal agriculture officer", "hi"): "मंडल कृषि अधिकारी",
    ("mandal agriculture officer", "ta"): "வட்டார வேளாண்மை அலுவலர்",
    ("mandal agriculture officer", "kn"): "ಮಂಡಲ ಕೃಷಿ ಅಧಿಕಾರಿ",
    ("mandal agriculture officer", "ml"): "മണ്ഡലം കാർഷിക ഓഫീസർ",
    ("mandal agriculture officer", "mr"): "मंडळ कृषी अधिकारी",

    # ---------------- Locations ----------------
    ("nellore", "te"): "నెల్లూరు",
    ("nellore", "hi"): "नेल्लोर",
    ("nellore", "ta"): "நெல்லூர்",
    ("nellore", "kn"): "ನೆಲ್ಲೂರು",
    ("nellore", "ml"): "നെല്ലൂർ",
    ("nellore", "mr"): "नेल्लोर",

    ("guntur", "te"): "గుంటూరు",
    ("guntur", "hi"): "गुंटूर",
    ("guntur", "ta"): "குண்டூர்",
    ("guntur", "kn"): "ಗುಂಟೂರು",
    ("guntur", "ml"): "ഗുണ്ടൂർ",
    ("guntur", "mr"): "गुंटूर",

    ("warangal", "te"): "వరంగల్",
    ("warangal", "hi"): "वारंगल",
    ("warangal", "ta"): "வாரங்கல்",
    ("warangal", "kn"): "ವರಂಗಲ್",
    ("warangal", "ml"): "വാറങ്കൽ",
    ("warangal", "mr"): "वारंगळ",

    ("khammam", "te"): "ఖమ్మం",
    ("khammam", "hi"): "खम्मम",
    ("khammam", "ta"): "கம்மம்",
    ("khammam", "kn"): "ಖಮ್ಮಂ",
    ("khammam", "ml"): "ഖമ്മം",
    ("khammam", "mr"): "खम्मम",

    ("adilabad", "te"): "ఆదిలాబాద్",
    ("adilabad", "hi"): "आदिलाबाद",
    ("adilabad", "ta"): "ஆதிலாபாத்",
    ("adilabad", "kn"): "ಆದಿಲಾಬಾದ್",
    ("adilabad", "ml"): "ആദിലാബാദ്",
    ("adilabad", "mr"): "आदिलाबाद",

    ("nizamabad", "te"): "నిజామాబాద్",
    ("nizamabad", "hi"): "निज़ामाबाद",
    ("nizamabad", "ta"): "நிசாமாபாத்",
    ("nizamabad", "kn"): "ನಿಜಾಮಾಬಾದ್",
    ("nizamabad", "ml"): "നിസാമാബാദ്",
    ("nizamabad", "mr"): "निझामाबाद",

    ("andhra pradesh", "te"): "ఆంధ్రప్రదేశ్",
    ("andhra pradesh", "hi"): "आंध्र प्रदेश",
    ("andhra pradesh", "ta"): "ஆந்திரப் பிரதேசம்",
    ("andhra pradesh", "kn"): "ಆಂಧ್ರಪ್ರದೇಶ",
    ("andhra pradesh", "ml"): "ആന്ധ്രാപ്രദേശ്",
    ("andhra pradesh", "mr"): "आंध्र प्रदेश",

    ("telangana", "te"): "తెలంగాణ",
    ("telangana", "hi"): "तेलंगाना",
    ("telangana", "ta"): "தெலுங்கானா",
    ("telangana", "kn"): "ತೆಲಂಗಾಣ",
    ("telangana", "ml"): "തെലങ്കാന",
    ("telangana", "mr"): "तेलंगणा",
}

def _canonical(term: str) -> str:
    """Return a normalized lower-case key for lookup.
    Strips surrounding whitespace, normalizes multiple spaces, and converts to lower case.
    """
    if not term:
        return ""
    return re.sub(r"\s+", " ", term.strip().lower())

def localize(term: Optional[str], language: str) -> str:
    """Return the localized string for *term* in *language*.

    - ``language`` may be any supported code (e.g. ``"te"``). ``"en"`` returns the original term.
    - If term is None or empty, returns empty string.
    - If a translation for a non-English language is missing, a ``KeyError`` is raised for strict audit,
      except if term is already in the target script or non-translatable.
    """
    if term is None:
        return ""
    raw = str(term).strip()
    if not raw:
        return ""
    lang = (language or "en").lower()[:2]
    if lang not in SUPPORTED_LANGUAGES or lang == "en":
        return raw

    key = (_canonical(raw), lang)
    if key in _TRANSLATIONS:
        return _TRANSLATIONS[key]

    raise KeyError(f"Missing translation for term '{raw}' in language '{lang}'")

def localize_safe(term: Optional[str], language: str) -> str:
    """Like localize, but returns the original term if translation is missing instead of raising."""
    if term is None:
        return ""
    try:
        return localize(term, language)
    except KeyError:
        return str(term)

def localize_fields(data: dict, language: str, fields: list[str]) -> dict:
    """Return a shallow copy of *data* with only the indicated *fields* localized.

    The function does **not** modify the original dict. It walks the selected keys and, if the value
    is a string, replaces it via :func:`localize`. List values are mapped element-wise.
    """
    result = data.copy()
    for f in fields:
        if f not in result:
            continue
        val = result[f]
        if isinstance(val, str):
            result[f] = localize(val, language)
        elif isinstance(val, list):
            result[f] = [localize(v, language) if isinstance(v, str) else v for v in val]
    return result
