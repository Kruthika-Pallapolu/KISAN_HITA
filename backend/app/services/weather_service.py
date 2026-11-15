import httpx
import json
import logging
import math
import threading
import time
import unicodedata
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
from urllib.parse import urlparse
from ..models.schemas import WeatherData, ForecastDay

logger = logging.getLogger("weather_service")

OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"

# Load geographic directories
_BASE_DATA_DIR = Path(__file__).resolve().parents[3] / "frontend" / "src" / "data"
_GEO_DIRECTORY_PATH = _BASE_DATA_DIR / "indiaAdminLgd.json"
with _GEO_DIRECTORY_PATH.open(encoding="utf-8") as _geo_file:
    _GEO_DIRECTORY = json.load(_geo_file)
_STATES = _GEO_DIRECTORY["states"]
_DISTRICTS = _GEO_DIRECTORY["districts"]

_SUPPORTED_LOCATIONS_PATH = _BASE_DATA_DIR / "weatherSupportedLocations.json"
with _SUPPORTED_LOCATIONS_PATH.open(encoding="utf-8") as _f:
    _SUPPORTED_DATA = json.load(_f)

_weather_supported_districts: Dict[Tuple[str, str], Dict[str, Any]] = {}
_supported_location_catalog: Dict[int, Dict[str, Any]] = {}

_loc_id_counter = 1
for state_entry in _SUPPORTED_DATA.get("states", []):
    s_name = state_entry["name"]
    for d_entry in state_entry.get("districts", []):
        if d_entry.get("verified"):
            key = (d_entry["name"].casefold(), s_name.casefold())
            record = {
                "location_id": _loc_id_counter,
                "name": d_entry["name"],
                "region": s_name,
                "country": "India",
                "lat": float(d_entry["latitude"]),
                "lon": float(d_entry["longitude"]),
                "latitude": float(d_entry["latitude"]),
                "longitude": float(d_entry["longitude"]),
                "status": d_entry.get("status", "verified_supported"),
            }
            _weather_supported_districts[key] = record
            _supported_location_catalog[_loc_id_counter] = record
            _loc_id_counter += 1

_TRANSLATIONS_PATH = _BASE_DATA_DIR / "locationTranslations.json"
with _TRANSLATIONS_PATH.open(encoding="utf-8") as _tf:
    _LOCATION_TRANSLATIONS = json.load(_tf)

_LOCALIZED_TO_CANONICAL: Dict[str, str] = {}
for lang, mapping in _LOCATION_TRANSLATIONS.items():
    if isinstance(mapping, dict):
        for canonical, localized in mapping.items():
            if isinstance(localized, str):
                _LOCALIZED_TO_CANONICAL[localized.strip().casefold()] = canonical


# Base error classes
class WeatherError(RuntimeError):
    """Base class for Weather-related errors used across the codebase."""
    def __init__(self, code: str = "weather_error", message: str = "", status_code: int = 500):
        super().__init__(message or code)
        self.code = code
        self.message = message or code
        self.status_code = status_code


class WeatherCoverageUnavailable(WeatherError):
    """Valid directory location, but no verifiable administrative coordinates."""
    def __init__(self, message: str = "Weather coverage is currently unavailable for this location."):
        super().__init__("weather_coverage_unavailable", message, 503)


class WeatherGeocodingUnavailable(WeatherError):
    """Geocoding service/network could not verify coordinates."""
    def __init__(self, message: str = "Geocoding service is temporarily unavailable."):
        super().__init__("weather_geocoding_unavailable", message, 503)


class WeatherProviderUnavailable(WeatherError):
    """Forecast provider could not provide a usable forecast."""
    def __init__(self, message: str = "Live weather forecast is temporarily unavailable."):
        super().__init__("weather_provider_unavailable", message, 503)


class WeatherConfigurationMissing(WeatherProviderUnavailable):
    """Required configuration is absent."""
    def __init__(self, message: str = "Weather configuration is missing."):
        super().__init__(message)
        self.code = "weather_configuration_missing"


class WeatherLocationNotFound(WeatherError):
    """Search did not find the requested location."""
    def __init__(self, message: str = "Weather location was not found."):
        super().__init__("weather_location_not_found", message, 404)


class WeatherLocationAmbiguous(WeatherError):
    """Search returned multiple plausible locations."""
    def __init__(self, message: str = "Multiple matching weather locations found."):
        super().__init__("weather_location_ambiguous", message, 422)


class WeatherInvalidLocation(WeatherError, ValueError):
    """Invalid location or district/state combination."""
    def __init__(self, code: str = "invalid_location", message: str = "Invalid location", status_code: int = 422):
        super().__init__(code, message, status_code)


_STATE_ALIASES = {
    "orissa": "odisha",
    "pondicherry": "puducherry",
    "uttaranchal": "uttarakhand",
    "nct of delhi": "delhi",
    "national capital territory of delhi": "delhi",
    "dadra and nagar haveli": "the dadra and nagar haveli and daman and diu",
    "daman and diu": "the dadra and nagar haveli and daman and diu",
    "dadra and nagar haveli and daman and diu": "the dadra and nagar haveli and daman and diu",
    "chhatisgarh": "chhattisgarh",
    "chhattisgarh": "chhattisgarh",
}


def _canonical_state(state: str) -> str:
    cleaned = (state or "").strip()
    if not cleaned:
        return ""
    if cleaned.casefold() in _LOCALIZED_TO_CANONICAL:
        cleaned = _LOCALIZED_TO_CANONICAL[cleaned.casefold()]
    norm = unicodedata.normalize("NFKD", cleaned.casefold())
    norm = "".join(c for c in norm if not unicodedata.combining(c)).strip()
    target_norm = _STATE_ALIASES.get(norm, norm)
    for s in _STATES:
        s_clean = s["name"]
        if s_clean.casefold() == cleaned.casefold():
            return s["name"]
        s_norm = unicodedata.normalize("NFKD", s_clean.casefold())
        s_norm = "".join(c for c in s_norm if not unicodedata.combining(c)).strip()
        if s_norm == target_norm or _STATE_ALIASES.get(s_norm, s_norm) == target_norm:
            return s["name"]
    return cleaned


def _canonical_district(district: str, state: str) -> Optional[dict]:
    st_name = _canonical_state(state)
    target_state = next((s for s in _STATES if s["name"].casefold() == st_name.casefold()), None)
    if not target_state:
        return None
    d_clean = (district or "").strip()
    if not d_clean:
        return None
    if d_clean.casefold() in _LOCALIZED_TO_CANONICAL:
        d_clean = _LOCALIZED_TO_CANONICAL[d_clean.casefold()]
    norm = unicodedata.normalize("NFKD", d_clean.casefold())
    norm = "".join(c for c in norm if not unicodedata.combining(c)).strip()
    for d in _DISTRICTS:
        if d["stateCode"] == target_state["code"]:
            if d["name"].casefold() == d_clean.casefold():
                return {"id": d["id"], "name": d["name"], "stateCode": d["stateCode"]}
            d_norm = unicodedata.normalize("NFKD", d["name"].casefold())
            d_norm = "".join(c for c in d_norm if not unicodedata.combining(c)).strip()
            if d_norm == norm:
                return {"id": d["id"], "name": d["name"], "stateCode": d["stateCode"]}
            for alias in d.get("aliases", []):
                if alias.casefold() == d_clean.casefold():
                    return {"id": d["id"], "name": d["name"], "stateCode": d["stateCode"]}
                a_norm = unicodedata.normalize("NFKD", alias.casefold())
                a_norm = "".join(c for c in a_norm if not unicodedata.combining(c)).strip()
                if a_norm == norm:
                    return {"id": d["id"], "name": d["name"], "stateCode": d["stateCode"]}
    return None


_geocode_cache: Dict[Tuple[str, str], Dict[str, Any]] = OrderedDict()
_forecast_cache: Dict[Tuple[float, float], Dict[str, Any]] = OrderedDict()


async def _get_json(url: str, params: Optional[dict] = None) -> Any:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            if resp.status_code != 200:
                raise WeatherError("weather_provider_unavailable", f"Open-Meteo returned HTTP {resp.status_code}", 503)
            return resp.json()
    except httpx.TimeoutException:
        raise WeatherError("weather_provider_timeout", "Open-Meteo request timed out", 504)
    except httpx.RequestError as exc:
        raise WeatherError("weather_provider_unavailable", str(exc), 503)


async def resolve_location(district: str, state: Optional[str] = None) -> dict:
    if not district or not district.strip():
        raise WeatherError("invalid_location", "A district is required.", 422)
    canonical_state_name = _canonical_state(state) if state else None
    if canonical_state_name:
        cand = _canonical_district(district, canonical_state_name)
        if not cand:
            raise WeatherInvalidLocation("invalid_location", f"{district} is not a district in {canonical_state_name}", 422)
        canonical_district_name = cand["name"]
    else:
        # Check ambiguous across states
        matching = []
        d_norm = district.strip().casefold()
        for d in _DISTRICTS:
            if d["name"].casefold() == d_norm or any(a.casefold() == d_norm for a in d.get("aliases", [])):
                st = next((s for s in _STATES if s["code"] == d["stateCode"]), None)
                if st:
                    matching.append((d, st))
        if len(matching) > 1:
            raise ValueError(f"Select a state to check {district}. Multiple states have that district name.")
        if not matching:
            raise WeatherInvalidLocation("invalid_location", f"District {district} not found in any state.", 422)
        canonical_district_name = matching[0][0]["name"]
        canonical_state_name = matching[0][1]["name"]

    supp_key = (canonical_district_name.casefold(), canonical_state_name.casefold())
    if supp_key not in _weather_supported_districts:
        raise WeatherCoverageUnavailable(f"Weather coverage is not verified for {canonical_district_name}, {canonical_state_name}.")

    cache_key = supp_key
    if cache_key in _geocode_cache:
        return _geocode_cache[cache_key]

    # Geocoding API lookup
    url = OPEN_METEO_GEOCODING_URL
    params = {"name": canonical_district_name, "count": 10, "language": "en", "format": "json"}
    data = await _get_json(url, params)

    candidates = data.get("results") if isinstance(data, dict) else (data if isinstance(data, list) else None)
    if candidates is None:
        candidates = []

    if not candidates:
        # Empty results -> fallback to verified registry coordinates
        verified_info = _weather_supported_districts[supp_key]
        res = {
            "district": canonical_district_name,
            "state": canonical_state_name,
            "latitude": verified_info["latitude"],
            "longitude": verified_info["longitude"],
            "source": "Verified Indian District Registry / Open-Meteo",
        }
        _geocode_cache[cache_key] = res
        return res

    valid_candidates = []
    for item in candidates:
        if not isinstance(item, dict):
            continue
        country_code = str(item.get("country_code") or "").strip().upper()
        if country_code != "IN":
            continue
        admin1 = str(item.get("admin1") or "").strip()
        if not WeatherService._same_state(admin1, canonical_state_name):
            continue
        valid_candidates.append(item)

    if not valid_candidates:
        raise WeatherError("weather_location_not_found", f"No matching location found in {canonical_state_name}", 404)

    if len(valid_candidates) > 1:
        adm2_matches = [c for c in valid_candidates if c.get("feature_code") == "ADM2"]
        if len(adm2_matches) == 1:
            chosen = adm2_matches[0]
        else:
            raise WeatherError("weather_location_ambiguous", f"Ambiguous locations returned for {canonical_district_name}, {canonical_state_name}", 422)
    else:
        chosen = valid_candidates[0]

    lat = float(chosen["latitude"])
    lon = float(chosen["longitude"])
    res = {
        "district": canonical_district_name,
        "state": canonical_state_name,
        "latitude": lat,
        "longitude": lon,
        "source": "Open-Meteo Geocoding API",
    }
    _geocode_cache[cache_key] = res
    return res


async def get_forecast(
    district: Optional[str] = None,
    state: Optional[str] = None,
    *,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    language: str = "en",
    **kwargs,
) -> dict:
    if latitude is None:
        latitude = kwargs.get("lat")
    if longitude is None:
        longitude = kwargs.get("lon")
    if latitude is not None or longitude is not None:
        try:
            lat = float(latitude)
            lon = float(longitude)
        except (TypeError, ValueError):
            raise WeatherError("invalid_coordinates", "Coordinates must be valid numbers.", 422)
        if math.isnan(lat) or math.isnan(lon) or not math.isfinite(lat) or not math.isfinite(lon) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise WeatherError("invalid_coordinates", "Coordinates must be finite numbers between -90 and 90 / -180 and 180.", 422)
        location_info = {
            "district": None,
            "state": None,
            "latitude": lat,
            "longitude": lon,
            "source": "User-provided coordinates",
        }
    elif district:
        location_info = await resolve_location(district, state)
        lat = location_info["latitude"]
        lon = location_info["longitude"]
    else:
        raise WeatherError("invalid_location", "Either district or coordinates must be provided.", 422)

    cache_key = (round(lat, 4), round(lon, 4))
    if cache_key in _forecast_cache:
        return _forecast_cache[cache_key]

    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m",
        "hourly": "temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
        "timezone": "auto",
    }
    raw = await _get_json(OPEN_METEO_FORECAST_URL, params)
    if not isinstance(raw, dict) or not raw.get("current") or not raw.get("hourly", {}).get("time") or not raw.get("daily", {}).get("time"):
        raise WeatherError("weather_provider_unavailable", "Open-Meteo returned an incomplete forecast response.", 503)

    result = {
        "location": location_info,
        "current": raw.get("current", {}),
        "hourly": raw.get("hourly", {}),
        "daily": raw.get("daily", {}),
        "units": {
            "temperature": "°C",
            "wind_speed": "km/h",
            "precipitation": "mm",
        },
        "provider": "Open-Meteo",
        "provider_url": "https://open-meteo.com/",
        "license": "CC BY 4.0",
        "license_url": "https://open-meteo.com/en/licence",
        "commercial_use_notice": "Open-Meteo free tier is for non-commercial use only.",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _forecast_cache[cache_key] = result
    return result


def _degrees_to_cardinal(deg: Any) -> str:
    try:
        val = float(deg)
    except (TypeError, ValueError):
        return "N"
    directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    idx = int((val + 11.25) / 22.5) % 16
    return directions[idx]


_WMO_DESCRIPTIONS: Dict[int, str] = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
    95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
}


def get_localized_weather_advice(rain_prob: int, wind_speed: float, language: str) -> tuple[str, str, str, str]:
    lang = (language or "en")[:2].lower()
    if lang == "te":
        if rain_prob > 50:
            irrigation = "వర్షం పడే అవకాశం ఉంది (50% కంటే ఎక్కువ). నీరు నిల్వ ఉండకుండా నీటిపారుదలని తాత్కాలికంగా ఆపండి."
            adv = "భారీ వర్ష సూచన ఉంది. పొలాల్లో మురుగు నీటి కాలువలను శుభ్రం చేసుకోండి."
        elif rain_prob > 30:
            irrigation = "తుంపర జల్లులు పడే అవకాశం ఉంది. నేల పైభాగం పొడిగా ఉంటేనే తక్కువ నీరు పెట్టండి."
            adv = "పాక్షికంగా మేఘావృతమైన వాతావరణం. అడపాదడపా వర్షం పడవచ్చు."
        else:
            irrigation = "పొడి వాతావరణం ఉంటుంది. పంట దశకు తగినట్లు సాధారణ నీటిపారుదల కొనసాగించండి."
            adv = "సాధారణ వ్యవసాయ వాతావరణం. పొలం పనులకు అనుకూల సమయం."

        if wind_speed < 15:
            spray = "అనుకూల గాలి వేగం (గాలి తీవ్రత తక్కువ). 4-6 గంటల్లో వర్షం లేకపోవడం నిర్ధారించుకొని, మందు లేబుల్ నిబంధనల ప్రకారం పిచికారీ చేయండి."
        elif wind_speed < 25:
            spray = "జాగ్రత్త (గాలి వేగం 15-25 km/h, మందు కొట్టుకుపోయే ప్రమాదం ఉంది — ఉదయం వేళ మాత్రమే పిచికారీ చేయండి)"
        else:
            spray = "అనుకూలం కాదు (తీవ్రమైన గాలి వల్ల మందు వ్యర్థమవుతుంది, పిచికారీ వాయిదా వేయండి)"

        produce = "వర్ష ప్రమాదం: కోసిన ధాన్యం, పత్తి, ఎండబెట్టిన మిర్చిని టార్పాలిన్లతో భద్రపరచండి." if rain_prob > 50 else "సాధారణ జాగ్రత్తలు: పగటిపూట ఎండబెట్టుకోవడానికి అనుకూలం."
    elif lang == "hi":
        if rain_prob > 50:
            irrigation = "बारिश की अधिक संभावना (>50%) है। खेत में जलभराव रोकने के लिए सिंचाई रोक दें।"
            adv = "भारी बारिश का पूर्वानुमान। खेतों में जल निकासी नाली की जांच करें।"
        elif rain_prob > 30:
            irrigation = "छिटपुट बारिश की संभावना। केवल ऊपरी मिट्टी सूखने पर ही हल्की सिंचाई करें।"
            adv = "आंशिक रूप से बादल छाए रहेंगे। हल्की बारिश का जोखिम।"
        else:
            irrigation = "मौसम शुष्क रहेगा। फसल चक्र अनुसार नियमित सिंचाई जारी रखें।"
            adv = "सामान्य कृषि मौसम। दैनिक कृषि कार्यों के लिए उत्तम समय।"

        if wind_speed < 15:
            spray = "अनुकूल हवा की गति (बहाव का जोखिम कम)। छिड़काव से पहले 4-6 घंटे बारिश न होने की पुष्टि करें और उत्पाद लेबल का पालन करें।"
        elif wind_speed < 25:
            spray = "सावधानी (मध्यम हवा 15-25 किमी/घंटा — केवल सुबह शांत समय छिड़काव करें)"
        else:
            spray = "अनुपयुक्त (तेज हवा के कारण छिड़काव का नुकसान होगा, छिड़काव टालें)"

        produce = "बारिश का जोखिम: कटी फसल और सूख रही उपज को तिरपाल से ढकें।" if rain_prob > 50 else "सामान्य निगरानी: दिन में खुले खलिहान में सुखाना सुरक्षित है।"
    else:
        if rain_prob > 50:
            irrigation = "Rain expected (probability > 50%). Hold off on flood or deep irrigation today to avoid waterlogging."
            adv = "High rain probability in forecast. Check drainage channels in fields."
        elif rain_prob > 30:
            irrigation = "Moderate chance of scattered showers. Light irrigation only if soil top layer is dry."
            adv = "Partly cloudy conditions with scattered precipitation risk."
        else:
            irrigation = "Dry weather expected. Maintain regular irrigation schedule according to crop stage."
            adv = "Normal agricultural weather. Good window for standard farm activities."

        if wind_speed < 15:
            spray = "Favorable wind conditions (low drift risk). Verify absence of rain within 4–6 hours and follow product label before spraying."
        elif wind_speed < 25:
            spray = "Caution (Moderate wind 15–25 km/h — elevated drift risk. Spray only during early calm morning hours using low-drift nozzles)"
        else:
            spray = "Unsuitable (High wind gusts >25 km/h — spray drift will cause chemical loss and uneven coverage. Postpone spraying)"

        produce = "High rain risk: Keep harvested grains, cotton pods, and dried chillies securely under waterproof tarpaulins." if rain_prob > 50 else "Standard precautions: Safe for yard drying under normal daytime supervision."

    return irrigation, adv, spray, produce


class WeatherService:
    _geocode_cache = _geocode_cache
    _forecast_cache = _forecast_cache
    _location_search_cache: Dict[str, Any] = OrderedDict()
    _supported_location_catalog = _supported_location_catalog
    _cache_lock = threading.Lock()

    @staticmethod
    def _normalize_name(value: str) -> str:
        value = unicodedata.normalize("NFKD", (value or "").strip().casefold())
        value = "".join(ch for ch in value if not unicodedata.combining(ch))
        value = value.replace("&", " and ")
        for suffix in (" district", " dist.", " dist"):
            if value.endswith(suffix):
                value = value[:-len(suffix)].strip()
        return " ".join(value.split())

    @staticmethod
    def _same_state(actual: str, requested: str) -> bool:
        act = WeatherService._normalize_name(actual)
        req = WeatherService._normalize_name(requested)
        return _STATE_ALIASES.get(act, act) == _STATE_ALIASES.get(req, req)

    @staticmethod
    def _canonical_location(district: str, state: Optional[str]) -> tuple[dict, dict]:
        d_norm = WeatherService._normalize_name(district)
        if not d_norm:
            raise ValueError("A district is required for district-based weather.")
        if state:
            s_name = _canonical_state(state)
            cand = _canonical_district(district, s_name)
            if not cand:
                raise WeatherInvalidLocation("invalid_location", f"'{district}' is not a district in '{state}'.", 422)
            st = next(s for s in _STATES if s["name"].casefold() == s_name.casefold())
            return st, cand

        # No state provided -> resolve if unique
        matching = []
        for d in _DISTRICTS:
            if WeatherService._normalize_name(d["name"]) == d_norm or any(WeatherService._normalize_name(a) == d_norm for a in d.get("aliases", [])):
                st = next((s for s in _STATES if s["code"] == d["stateCode"]), None)
                if st:
                    matching.append((st, d))
        if len(matching) > 1:
            raise ValueError(f"Select a state to check {district}. Multiple states have that district name.")
        if not matching:
            raise WeatherInvalidLocation("invalid_location", f"District '{district}' not found in any state.", 422)
        return matching[0][0], matching[0][1]

    @staticmethod
    def _valid_coordinates(latitude: Any, longitude: Any) -> tuple[float, float]:
        try:
            lat = float(latitude)
            lon = float(longitude)
        except (TypeError, ValueError):
            raise WeatherCoverageUnavailable("Invalid coordinates provided.")
        if not math.isfinite(lat) or not math.isfinite(lon) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise WeatherCoverageUnavailable("Coordinates are outside valid global range.")
        return lat, lon

    @staticmethod
    def _verified_indian_coordinates(latitude: Any, longitude: Any) -> tuple[float, float]:
        lat, lon = WeatherService._valid_coordinates(latitude, longitude)
        if not (6.0 <= lat <= 38.0 and 68.0 <= lon <= 98.0):
            raise WeatherCoverageUnavailable(f"Coordinates ({lat}, {lon}) are outside India bounding box.")
        return lat, lon

    @staticmethod
    def _wmo_icon(condition_code: int) -> str:
        if condition_code in (0, 1):
            return "sun"
        if condition_code in (2, 3):
            return "cloud-sun"
        if condition_code in (45, 48):
            return "cloud-fog"
        if condition_code in (51, 53, 55, 61, 63, 65, 80, 81, 82):
            return "cloud-rain"
        if condition_code in (95, 96, 99):
            return "cloud-lightning"
        return "cloud-sun"

    @staticmethod
    def get_supported_locations(state: Optional[str] = None) -> list[dict]:
        locs = list(_supported_location_catalog.values())
        if state:
            target_state = _canonical_state(state)
            locs = [l for l in locs if WeatherService._same_state(l["region"], target_state)]
        return sorted(locs, key=lambda x: (x["region"], x["name"]))

    @staticmethod
    async def get_district_weather(district_query: str, state_query: Optional[str] = None, language: str = "en") -> WeatherData:
        payload = await get_forecast(district=district_query, state=state_query, language=language)
        return WeatherService._payload_to_weather_data(payload, language)

    @staticmethod
    async def get_coordinate_weather(latitude: float, longitude: float, language: str = "en") -> WeatherData:
        payload = await get_forecast(latitude=latitude, longitude=longitude, language=language)
        return WeatherService._payload_to_weather_data(payload, language)

    @staticmethod
    async def get_location_weather(location_query: str, language: str = "en") -> WeatherData:
        query = (location_query or "").strip()
        if len(query) < 2:
            raise ValueError("Enter at least two characters to search for a location.")
        raw_parts = [p.strip() for p in query.split("/")] if "/" in query else [p.strip() for p in query.split(",")]
        if len(raw_parts) == 2 and all(raw_parts):
            first, second = raw_parts
            states = [s for s in _STATES if WeatherService._same_state(s["name"], first) or WeatherService._same_state(s["name"], second)]
            if len(states) == 1:
                st_name = states[0]["name"]
                place = second if WeatherService._same_state(st_name, first) else first
                place = " ".join("Bengaluru" if p.casefold() == "benguluru" else p for p in place.split())
                return await WeatherService.get_district_weather(place, st_name, language)

        # Single place query
        return await WeatherService.get_district_weather(query, None, language)

    @staticmethod
    async def get_catalog_location_weather(location_id: int, language: str = "en") -> WeatherData:
        loc = _supported_location_catalog.get(location_id)
        if not loc:
            raise WeatherLocationNotFound(f"Location ID {location_id} not found in supported catalog.")
        return await WeatherService.get_district_weather(loc["name"], loc["region"], language)

    @staticmethod
    def _payload_to_weather_data(payload: dict, language: str) -> WeatherData:
        loc = payload.get("location") or {}
        cur = payload.get("current") or {}
        daily = payload.get("daily") or {}
        hourly = payload.get("hourly") or {}

        district = loc.get("district") or "Selected location"
        state = loc.get("state") or "India"
        country = "India"
        temp = float(cur.get("temperature_2m", 25.0))
        feels = float(cur.get("apparent_temperature", temp))
        humidity = int(cur.get("relative_humidity_2m", 50))
        wind_spd = float(cur.get("wind_speed_10m", 10.0))
        wind_dir = _degrees_to_cardinal(cur.get("wind_direction_10m", 0))
        rainfall = float(cur.get("precipitation", 0.0))
        wmo_code = int(cur.get("weather_code", 0))
        condition_text = _WMO_DESCRIPTIONS.get(wmo_code, "Partly cloudy")

        daily_probs = daily.get("precipitation_probability_max") or [0]
        rain_prob = int(daily_probs[0]) if daily_probs else 0

        irrigation, advisory, spray, produce = get_localized_weather_advice(rain_prob, wind_spd, language)

        # Build 7-day forecast
        daily_times = daily.get("time") or []
        daily_maxs = daily.get("temperature_2m_max") or []
        daily_mins = daily.get("temperature_2m_min") or []
        daily_codes = daily.get("weather_code") or []
        forecast_days = []
        for i, dt in enumerate(daily_times[:7]):
            c_code = int(daily_codes[i]) if i < len(daily_codes) else 0
            day_max = float(daily_maxs[i]) if i < len(daily_maxs) else temp
            day_min = float(daily_mins[i]) if i < len(daily_mins) else temp
            p_val = int(daily_probs[i]) if i < len(daily_probs) else 0
            try:
                parsed_dt = datetime.strptime(dt, "%Y-%m-%d")
                d_name = "Today" if i == 0 else parsed_dt.strftime("%a")
            except Exception:
                d_name = f"Day {i+1}"
            forecast_days.append(ForecastDay(
                day_name=d_name,
                date=dt,
                temp_max=day_max,
                temp_min=day_min,
                condition=_WMO_DESCRIPTIONS.get(c_code, "Clear sky"),
                condition_code=c_code,
                precipitation_probability=p_val,
                icon=WeatherService._wmo_icon(c_code),
            ))

        return WeatherData(
            district=district,
            state=state,
            country=country,
            location_id=loc.get("location_id"),
            temperature=temp,
            feels_like=feels,
            condition=condition_text,
            condition_code=wmo_code,
            condition_icon_url=None,
            humidity=humidity,
            wind_speed=wind_spd,
            wind_direction=wind_dir,
            visibility_km=10.0,
            rain_probability=rain_prob,
            rainfall_mm=rainfall,
            advisory=advisory,
            irrigation_advice=irrigation,
            spray_suitability=spray,
            produce_protection=produce,
            is_official_alert=False,
            source="Open-Meteo live forecast",
            coordinate_source=loc.get("source"),
            retrieval_timestamp=datetime.now(timezone.utc).isoformat(),
            forecast=forecast_days,
            provider="Open-Meteo",
            provider_url="https://open-meteo.com/",
            license="CC BY 4.0",
            license_url="https://open-meteo.com/en/licence",
            commercial_use_notice="Open-Meteo free tier is for non-commercial use only.",
            location=loc,
            current=cur,
            hourly=hourly,
            daily=daily,
            units=payload.get("units", {"temperature": "°C", "wind_speed": "km/h", "precipitation": "mm"}),
        )
