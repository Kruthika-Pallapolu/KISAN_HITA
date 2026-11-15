import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestWeather, WeatherApiError } from '../services/weatherApi.ts';
import { generateDemoForecast } from '../services/weatherFallback.ts';
import { getDistrictsForState, getState, getWeatherDistrictsForState, isWeatherSupportedDistrict, resetDistrictForStateChange, STATES, WEATHER_STATES } from '../services/geography.ts';
import { localizeLocation } from '../i18n/agriculture.ts';
import { weatherVoiceCopy } from '../i18n/weatherVoice.ts';

test('weather request sends canonical district, state and selected language through relative API', async () => {
  const original = globalThis.fetch;
  let url;
  globalThis.fetch = async (input) => { url = String(input); return { ok:true, json:async()=>({ provider:'Open-Meteo', current:{temperature_2m:30}, hourly:{time:['x']}, daily:{time:['x']} }) }; };
  try { await requestWeather({ district:'Nellore', state:'Andhra Pradesh', language:'te' }); }
  finally { globalThis.fetch = original; }
  assert.match(url, /^\/api\/weather\/current\?/);
  assert.match(url, /district=Nellore/);
  assert.match(url, /state=Andhra\+Pradesh/);
  assert.match(url, /language=te/);
  assert.doesNotMatch(url, /localhost|127\.0\.0\.1/);
});

test('state change clears district and district options remain filtered by canonical state', () => {
  assert.deepEqual(resetDistrictForStateChange('Andhra Pradesh'), { state:'Andhra Pradesh', district:'' });
  const ap = getDistrictsForState('Andhra Pradesh');
  assert.ok(ap.some((row) => row.name === 'Nellore'));
  assert.ok(!ap.some((row) => row.name === 'Hyderabad'));
});

test('weather labels and visible source/licence copy exist in every supported language', () => {
  for (const lang of ['te','en','hi','ta','kn','ml','mr']) {
    assert.ok(weatherVoiceCopy[lang].weatherAttribution);
    assert.ok(weatherVoiceCopy[lang].weatherLicense);
    assert.ok(weatherVoiceCopy[lang].weatherNonCommercial);
    assert.ok(weatherVoiceCopy[lang].weatherDistrictDisclaimer);
    assert.ok(localizeLocation('Andhra Pradesh', lang));
  }
});

test('all WMO weather condition interpretation codes exist in all seven languages', () => {
  const source = readFileSync(new URL('../pages/WeatherPage.tsx', import.meta.url), 'utf8');
  const match = source.match(/CONDITIONS[\s\S]*?=\s*({[\s\S]*?\n};)/);
  assert.ok(match, 'CONDITIONS definition found in WeatherPage.tsx');
  const conditions = eval('(' + match[1].replace(/};$/, '}') + ')');
  const requiredCodes = [0, 1, 2, 3, 45, 48, 51, 53, 55, 61, 63, 65, 71, 73, 75, 80, 81, 82, 95, 96, 99];
  const langs = ['en', 'te', 'hi', 'ta', 'kn', 'ml', 'mr'];
  for (const lang of langs) {
    assert.ok(conditions[lang], `CONDITIONS for language ${lang} exists`);
    for (const code of requiredCodes) {
      assert.ok(conditions[lang][code], `CONDITIONS.${lang}[${code}] is missing`);
      assert.ok(typeof conditions[lang][code] === 'string' && conditions[lang][code].trim().length > 0, `CONDITIONS.${lang}[${code}] must be non-empty`);
    }
  }
});

test('district-area forecast disclaimer exists and is translated in all seven languages', () => {
  const source = readFileSync(new URL('../pages/WeatherPage.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes("t('weatherDistrictDisclaimer')"), 'WeatherPage renders weatherDistrictDisclaimer');
  const langs = ['en', 'te', 'hi', 'ta', 'kn', 'ml', 'mr'];
  for (const lang of langs) {
    const text = weatherVoiceCopy[lang]?.weatherDistrictDisclaimer;
    assert.ok(text && text.trim().length > 0, `weatherDistrictDisclaimer is missing or empty in ${lang}`);
  }
});

test('provider errors are surfaced with their structured code and no stale success is fabricated', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok:false, status:503, json:async()=>({detail:{code:'weather_provider_unavailable',message:'Live service unavailable'}}) });
  try { await assert.rejects(requestWeather({ district:'Nellore', state:'Andhra Pradesh', language:'en' }), (error) => error instanceof WeatherApiError && error.code === 'weather_provider_unavailable'); }
  finally { globalThis.fetch = original; }
});

test('Telugu and multilingual location mapping preserves canonical English identifiers', () => {
  // 1. Telugu నెల్లూరు maps to canonical Nellore
  assert.equal(localizeLocation('Nellore', 'te'), 'నెల్లూరు');
  // 2. Telugu ఆంధ్రప్రదేశ్ maps to canonical Andhra Pradesh
  assert.equal(localizeLocation('Andhra Pradesh', 'te'), 'ఆంధ్రప్రదేశ్');
  // 3. English Nellore continues working
  assert.equal(localizeLocation('Nellore', 'en'), 'Nellore');
  // 4. All seven language selections preserve the correct canonical district identifier
  const expectedLabels = {
    te: 'నెల్లూరు',
    en: 'Nellore',
    hi: 'नेल्लोर',
    ta: 'நெல்லூர்',
    kn: 'ನೆಲ್ಲೂರು',
    ml: 'നെല്ലൂർ',
    mr: 'नेल्लोर',
  };
  for (const [lang, label] of Object.entries(expectedLabels)) {
    assert.equal(localizeLocation('Nellore', lang), label);
  }
  // 5. Changing the language does not alter the underlying canonical data
  const canonicalDistrict = 'Nellore';
  const canonicalState = 'Andhra Pradesh';
  const ap = getDistrictsForState(canonicalState);
  assert.ok(ap.some((row) => row.name === canonicalDistrict));
  // 6. Changing the state clears the previous district selection
  assert.deepEqual(resetDistrictForStateChange('Karnataka'), { state: 'Karnataka', district: '' });
});

test('Anakapalli maps correctly in Telugu and all seven languages while preserving canonical identifiers', () => {
  assert.equal(localizeLocation('Anakapalli', 'te'), 'అనకాపల్లి');
  assert.equal(localizeLocation('Anakapalli', 'en'), 'Anakapalli');
  assert.equal(localizeLocation('Anakapalli', 'hi'), 'अनकापल्ली');
  assert.equal(localizeLocation('Anakapalli', 'ta'), 'அனகாபள்ளி');
  assert.equal(localizeLocation('Anakapalli', 'kn'), 'ಅನಕಾಪಲ್ಲಿ');
  assert.equal(localizeLocation('Anakapalli', 'ml'), 'അനകപ്പള്ളി');
  assert.equal(localizeLocation('Anakapalli', 'mr'), 'अनकापल्ली');

  const ap = getDistrictsForState('Andhra Pradesh');
  assert.ok(ap.some((row) => row.name === 'Anakapalli'));
});

test('All 36 Indian states and Union Territories localize to authentic Telugu', () => {
  const expectedStateTelugu = {
    'Andaman And Nicobar Islands': 'అండమాన్ మరియు నికోబార్ దీవులు',
    'Andhra Pradesh': 'ఆంధ్రప్రదేశ్',
    'Arunachal Pradesh': 'అరుణాచల్ ప్రదేశ్',
    'Assam': 'అస్సాం',
    'Bihar': 'బీహార్',
    'Chandigarh': 'చండీగఢ్',
    'Chhattisgarh': 'ఛత్తీస్‌గఢ్',
    'Delhi': 'ఢిల్లీ',
    'Goa': 'గోవా',
    'Gujarat': 'గుజరాత్',
    'Haryana': 'హర్యానా',
    'Himachal Pradesh': 'హిమాచల్ ప్రదేశ్',
    'Jammu And Kashmir': 'జమ్ము మరియు కాశ్మీర్',
    'Jharkhand': 'జార్ఖండ్',
    'Karnataka': 'కర్ణాటక',
    'Kerala': 'కేరళ',
    'Ladakh': 'లడఖ్',
    'Lakshadweep': 'లక్షద్వీప్',
    'Madhya Pradesh': 'మధ్యప్రదేశ్',
    'Maharashtra': 'మహారాష్ట్ర',
    'Manipur': 'మణిపూర్',
    'Meghalaya': 'మేఘాలయ',
    'Mizoram': 'మిజోరం',
    'Nagaland': 'నాగాలాండ్',
    'Odisha': 'ఒడిశా',
    'Puducherry': 'పుదుచ్చేరి',
    'Punjab': 'పంజాబ్',
    'Rajasthan': 'రాజస్థాన్',
    'Sikkim': 'సిక్కిం',
    'Tamil Nadu': 'తమిళనాడు',
    'Telangana': 'తెలంగాణ',
    'The Dadra And Nagar Haveli And Daman And Diu': 'దాద్రా మరియు నగర్ హవేలీ మరియు డామన్ మరియు డయ్యూ',
    'Tripura': 'త్రిపుర',
    'Uttar Pradesh': 'ఉత్తరప్రదేశ్',
    'Uttarakhand': 'ఉత్తరాఖండ్',
    'West Bengal': 'పశ్చిమ బెంగాల్',
  };

  assert.equal(STATES.length, 36);
  for (const [stateName, expectedTelugu] of Object.entries(expectedStateTelugu)) {
    const localized = localizeLocation(stateName, 'te');
    assert.equal(localized, expectedTelugu, `Expected Telugu for ${stateName} to be ${expectedTelugu}, got ${localized}`);
  }
});

test('Chhattisgarh spelling variants resolve cleanly and localize to authentic Telugu', () => {
  assert.equal(getState('Chhattisgarh')?.name, 'Chhattisgarh');
  assert.equal(getState('Chhatisgarh')?.name, 'Chhattisgarh');
  assert.equal(localizeLocation('Chhattisgarh', 'te'), 'ఛత్తీస్‌గఢ్');
  assert.equal(localizeLocation('Chhatisgarh', 'te'), 'ఛత్తీస్‌గఢ్');
});

test('exactly 15 states with supported districts appear in WEATHER_STATES', () => {
  assert.equal(WEATHER_STATES.length, 15);
  const stateNames = WEATHER_STATES.map((s) => s.name).sort();
  const expectedStates = [
    'Andhra Pradesh', 'Bihar', 'Gujarat', 'Haryana', 'Karnataka',
    'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab',
    'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'West Bengal'
  ].sort();
  assert.deepEqual(stateNames, expectedStates);

  // States without verified districts do not appear
  for (const excluded of ['Delhi', 'Ladakh', 'Assam', 'Himachal Pradesh', 'Goa', 'Jammu And Kashmir', 'Sikkim']) {
    assert.ok(!WEATHER_STATES.some((s) => s.name === excluded), `${excluded} should not be in WEATHER_STATES`);
  }
});

test('exactly 309 verified supported districts are selectable across all supported states', () => {
  let totalSelectable = 0;
  const allSelectablePairs = new Set();
  const langs = ['en', 'te', 'hi', 'ta', 'kn', 'ml', 'mr'];

  for (const state of WEATHER_STATES) {
    const districts = getWeatherDistrictsForState(state.code);
    assert.ok(districts.length > 0, `${state.name} must have at least one supported district`);
    totalSelectable += districts.length;

    // Check uniqueness within state
    const ids = new Set();
    const names = new Set();
    for (const d of districts) {
      assert.ok(!ids.has(d.id), `Duplicate district id ${d.id} in ${state.name}`);
      assert.ok(!names.has(d.name), `Duplicate district name ${d.name} in ${state.name}`);
      ids.add(d.id);
      names.add(d.name);
      allSelectablePairs.add(`${d.name}|${state.name}`);

      // Verify localization across all seven languages
      for (const lang of langs) {
        const localized = localizeLocation(d.name, lang);
        assert.ok(localized && localized.trim().length > 0, `Missing translation for ${d.name} in ${lang}`);
      }
    }

    // Verify state localization in all seven languages
    for (const lang of langs) {
      const localizedState = localizeLocation(state.name, lang);
      assert.ok(localizedState && localizedState.trim().length > 0, `Missing translation for ${state.name} in ${lang}`);
    }
  }

  assert.equal(totalSelectable, 309, `Expected exactly 309 selectable districts, got ${totalSelectable}`);
  assert.equal(allSelectablePairs.size, 309);
});

test('no unverified district appears in weather district selection', () => {
  // Test known unverified districts from the 475 unverified list
  const gujaratDistricts = getWeatherDistrictsForState('Gujarat');
  assert.ok(!gujaratDistricts.some((d) => d.name === 'Arvalli'));
  assert.ok(!gujaratDistricts.some((d) => d.name === 'Aravalli'));
  assert.ok(!gujaratDistricts.some((d) => d.name === 'Banas Kantha'));

  const biharDistricts = getWeatherDistrictsForState('Bihar');
  assert.ok(!biharDistricts.some((d) => d.name === 'Araria'));

  // Test states with zero supported districts return empty list
  assert.deepEqual(getWeatherDistrictsForState('Delhi'), []);
  assert.deepEqual(getWeatherDistrictsForState('Ladakh'), []);
  assert.deepEqual(getWeatherDistrictsForState('Assam'), []);
});

test('alias handling preserves resolution to canonical supported district without creating duplicates', () => {
  // Aurangabad alias resolves to supported Chhatrapati Sambhajinagar
  assert.equal(isWeatherSupportedDistrict('Chhatrapati Sambhajinagar', 'Maharashtra'), true);
  assert.equal(isWeatherSupportedDistrict('Aurangabad', 'Maharashtra'), true);

  // Sri Potti Sriramulu Nellore alias resolves to supported Nellore
  assert.equal(isWeatherSupportedDistrict('Nellore', 'Andhra Pradesh'), true);
  assert.equal(isWeatherSupportedDistrict('Sri Potti Sriramulu Nellore', 'Andhra Pradesh'), true);

  // Unverified non-canonical or unverified districts return false
  assert.equal(isWeatherSupportedDistrict('Delhi', 'Delhi'), false);
  assert.equal(isWeatherSupportedDistrict('Aravalli', 'Gujarat'), false);
  assert.equal(isWeatherSupportedDistrict('Leh', 'Ladakh'), false);

  // Maharashtra dropdown has Chhatrapati Sambhajinagar once and no separate Aurangabad option
  const mhDistricts = getWeatherDistrictsForState('Maharashtra');
  assert.ok(mhDistricts.some((d) => d.name === 'Chhatrapati Sambhajinagar'));
  assert.ok(!mhDistricts.some((d) => d.name === 'Aurangabad'));
});

test('GPS weather and manual weather selection contracts are both supported', async () => {
  const original = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return {
      ok: true,
      json: async () => ({
        provider: 'Open-Meteo',
        current: { temperature_2m: 28 },
        hourly: { time: ['x'] },
        daily: { time: ['x'] },
      }),
    };
  };

  try {
    // 1. Manual weather request with supported district
    await requestWeather({ district: 'Nellore', state: 'Andhra Pradesh', language: 'en' });
    assert.match(requestedUrl, /district=Nellore/);
    assert.match(requestedUrl, /state=Andhra\+Pradesh/);

    // 2. GPS-based weather request with coordinates
    await requestWeather({ latitude: 14.4426, longitude: 79.9865, language: 'te' });
    assert.match(requestedUrl, /latitude=14\.4426/);
    assert.match(requestedUrl, /longitude=79\.9865/);
    assert.match(requestedUrl, /language=te/);
  } finally {
    globalThis.fetch = original;
  }
});

test('WeatherPage uses WEATHER_STATES and getWeatherDistrictsForState', () => {
  const source = readFileSync(new URL('../pages/WeatherPage.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('WEATHER_STATES'), 'WeatherPage must import and use WEATHER_STATES');
  assert.ok(source.includes('getWeatherDistrictsForState'), 'WeatherPage must use getWeatherDistrictsForState');
  assert.ok(source.includes('isWeatherSupportedDistrict'), 'WeatherPage must use isWeatherSupportedDistrict');
});

test('prototype mode: successful API response displays real weather', async () => {
  const original = globalThis.fetch;
  const mockRealPayload = {
    provider: 'Open-Meteo',
    provider_url: 'https://open-meteo.com/',
    license: 'CC BY 4.0',
    license_url: 'https://open-meteo.com/en/licence',
    location: { district: 'Nellore', state: 'Andhra Pradesh', latitude: 14.4426, longitude: 79.9865, source: 'backend_verified' },
    current: { temperature_2m: 31.4, apparent_temperature: 34.2, relative_humidity_2m: 62, precipitation: 0, weather_code: 1, wind_speed_10m: 12.5, wind_direction_10m: 85, time: '2026-11-13T12:00', cloud_cover: 20 },
    hourly: { time: ['2026-11-13T00:00'], temperature_2m: [27], apparent_temperature: [29], precipitation_probability: [10], precipitation: [0], weather_code: [1], wind_speed_10m: [10], visibility: [10000] },
    daily: { time: ['2026-11-13'], weather_code: [1], temperature_2m_max: [33], temperature_2m_min: [24], precipitation_probability_max: [20] },
    units: { temperature: '°C', wind_speed: 'km/h', precipitation: 'mm' },
    commercial_use_notice: 'Commercial use requires appropriate licensing.',
    updated_at: '2026-11-13 12:00',
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => mockRealPayload,
  });

  try {
    const data = await requestWeather({ district: 'Nellore', state: 'Andhra Pradesh', language: 'en' });
    assert.equal(data.provider, 'Open-Meteo');
    assert.equal(data.isDemo, undefined);
    assert.equal(data.current.temperature_2m, 31.4);
    assert.equal(data.location.source, 'backend_verified');
  } finally {
    globalThis.fetch = original;
  }
});

test('prototype mode: API timeout triggers demo fallback', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 504,
    json: async () => ({ detail: { code: 'weather_provider_timeout', message: 'Provider timed out' } }),
  });

  try {
    let result = null;
    try {
      result = await requestWeather({ district: 'Kurnool', state: 'Andhra Pradesh', language: 'en' });
    } catch (_err) {
      result = generateDemoForecast({ district: 'Kurnool', state: 'Andhra Pradesh' });
    }
    assert.ok(result);
    assert.equal(result.isDemo, true);
    assert.equal(result.provider, 'Demo Forecast');
    assert.equal(result.location.district, 'Kurnool');
    assert.equal(result.location.state, 'Andhra Pradesh');
    assert.equal(result.location.source, 'Demo / Illustrative Fallback');
    assert.equal(result.hourly.time.length, 24);
    assert.equal(result.daily.time.length, 7);
  } finally {
    globalThis.fetch = original;
  }
});

test('prototype mode: API error triggers demo fallback', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ detail: { code: 'weather_service_error', message: 'Internal service error' } }),
  });

  try {
    let result = null;
    try {
      result = await requestWeather({ district: 'Jaipur', state: 'Rajasthan', language: 'en' });
    } catch (_err) {
      result = generateDemoForecast({ district: 'Jaipur', state: 'Rajasthan' });
    }
    assert.ok(result);
    assert.equal(result.isDemo, true);
    assert.equal(result.location.district, 'Jaipur');
    assert.equal(result.location.state, 'Rajasthan');
    assert.ok(result.current.temperature_2m >= 20 && result.current.temperature_2m <= 45);
    assert.ok(result.current.relative_humidity_2m >= 20 && result.current.relative_humidity_2m <= 95);
  } finally {
    globalThis.fetch = original;
  }
});

test('prototype mode: demo forecast displays the correct disclaimer', () => {
  const fallback = generateDemoForecast({ district: 'Nellore', state: 'Andhra Pradesh' });
  assert.equal(fallback.commercial_use_notice, 'Demo Forecast — Illustrative data, not live weather.');

  // Verify exact string in English translation
  assert.equal(weatherVoiceCopy.en.weatherDemoDisclaimer, 'Demo Forecast — Illustrative data, not live weather.');

  // Verify WeatherPage includes the demo disclaimer key and component
  const pageSource = readFileSync(new URL('../pages/WeatherPage.tsx', import.meta.url), 'utf8');
  assert.ok(pageSource.includes("t('weatherDemoDisclaimer')"), 'WeatherPage must render weatherDemoDisclaimer');
  assert.ok(pageSource.includes('generateDemoForecast'), 'WeatherPage must invoke generateDemoForecast on fallback');
});

test('prototype mode: sample values remain stable during a displayed forecast', () => {
  const first = generateDemoForecast({ district: 'Guntur', state: 'Andhra Pradesh' });
  const second = generateDemoForecast({ district: 'Guntur', state: 'Andhra Pradesh' });

  // Same district yields identical deterministic values across re-renders
  assert.equal(first.current.temperature_2m, second.current.temperature_2m);
  assert.equal(first.current.apparent_temperature, second.current.apparent_temperature);
  assert.equal(first.current.relative_humidity_2m, second.current.relative_humidity_2m);
  assert.equal(first.current.wind_speed_10m, second.current.wind_speed_10m);
  assert.equal(first.current.weather_code, second.current.weather_code);
  assert.deepEqual(first.hourly.temperature_2m, second.hourly.temperature_2m);
  assert.deepEqual(first.daily.temperature_2m_max, second.daily.temperature_2m_max);

  // Different districts produce varied values
  const other = generateDemoForecast({ district: 'Bikaner', state: 'Rajasthan' });
  const valuesDiffer = first.current.temperature_2m !== other.current.temperature_2m ||
                       first.current.relative_humidity_2m !== other.current.relative_humidity_2m ||
                       first.current.wind_speed_10m !== other.current.wind_speed_10m;
  assert.ok(valuesDiffer, 'Different districts should produce varied sample values');
});

test('prototype mode: GPS failure uses demo fallback without claiming live GPS weather', async () => {
  const original = globalThis.fetch;
  // Simulate API rejection for GPS coordinates
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ detail: { code: 'weather_provider_unavailable', message: 'Service unavailable' } }),
  });

  try {
    let result = null;
    const gpsParams = { latitude: 17.385, longitude: 78.4867 };
    try {
      result = await requestWeather({ ...gpsParams, language: 'en' });
    } catch (_err) {
      result = generateDemoForecast(gpsParams);
    }

    assert.ok(result);
    assert.equal(result.isDemo, true);
    assert.equal(result.provider, 'Demo Forecast');
    // Crucially: source must NOT claim live GPS
    assert.equal(result.location.source, 'Demo / Illustrative Fallback');
    assert.notEqual(result.location.source, 'device_gps_live');
    assert.equal(result.location.latitude, 17.385);
    assert.equal(result.location.longitude, 78.4867);
  } finally {
    globalThis.fetch = original;
  }
});

test('prototype mode: all seven language versions display the appropriate disclaimer', () => {
  const languages = ['en', 'te', 'hi', 'ta', 'kn', 'ml', 'mr'];
  const expectedTranslations = {
    en: 'Demo Forecast — Illustrative data, not live weather.',
    te: 'డెమో వాతావరణ సూచన — ఇది ఉదాహరణ సమాచారం మాత్రమే, ప్రత్యక్ష వాతావరణం కాదు.',
    hi: 'डेमो पूर्वानुमान — यह केवल सांकेतिक डेटा है, वास्तविक मौसम नहीं।',
    ta: 'மாதிரி முன்னறிவிப்பு — இது விளக்க நோக்கிலான தரவு மட்டுமே, நேரடி வானிலை அல்ல.',
    kn: 'ಮಾದರಿ ಮುನ್ಸೂಚನೆ — ಇದು ವಿವರಣಾತ್ಮಕ ಮಾಹಿತಿ ಮಾತ್ರ, ನೈಜ ಹವಾಮಾನವಲ್ಲ.',
    ml: 'മാതൃകാ പ്രവചനം — ഇത് വിശദീകരണത്തിനുള്ള ഡാറ്റ മാത്രമാണ്, തത്സമയ കാലാവസ്ഥയല്ല.',
    mr: 'डेमो अंदाज — हा केवळ प्रात्यक्षिक डेटा आहे, थेट हवामान नाही.',
  };

  for (const lang of languages) {
    const copy = weatherVoiceCopy[lang]?.weatherDemoDisclaimer;
    assert.ok(copy && copy.trim().length > 0, `Missing weatherDemoDisclaimer for ${lang}`);
    assert.equal(copy, expectedTranslations[lang], `Unexpected translation for ${lang}`);
  }
});

test('WeatherPage displays as a standard page without unwanted backdrop blur or modal overlay', () => {
  const source = readFileSync(new URL('../pages/WeatherPage.tsx', import.meta.url), 'utf8');

  // Uses standard page container layout matching ChooseCrop and MarketPrices
  assert.match(source, /className="module-page weather-page"/);
  assert.match(source, /className="container"/);

  // Does not use backdrop blur or frosted glass filter that blurs background content
  assert.doesNotMatch(source, /backdropFilter:\s*['"]blur/);
  assert.doesNotMatch(source, /WebkitBackdropFilter:\s*['"]blur/);

  // Not presented as a modal or popup dialog
  assert.doesNotMatch(source, /role="dialog"/);
  assert.doesNotMatch(source, /className="modal/);
});
