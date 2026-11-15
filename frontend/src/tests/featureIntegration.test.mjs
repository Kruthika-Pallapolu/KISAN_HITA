import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Choose Crop submits only explicit selections and guards against stale results', () => {
  const page = source('../pages/ChooseCropPage.tsx');
  assert.match(page, /fetch\('\/api\/crop-advisor\/recommend'/);
  assert.match(page, /signal: controller\.signal/);
  assert.match(page, /request !== requestId\.current/);
  assert.match(page, /key=\{`\$\{rec\.crop_name\}:\$\{rec\.variety\}`\}/);
  assert.match(page, /t\('cropNoResults'\)/);
  assert.doesNotMatch(page, /useEffect\(\(\) => \{\s*fetchRecommendations\(\)/);
});

test('Market search sends selected filters and labels local illustrative records honestly', () => {
  const page = source('../pages/MarketPricesPage.tsx');
  assert.match(page, /params\.append\('commodity', comm\.trim\(\)\)/);
  assert.match(page, /params\.append\('state', st\)/);
  assert.match(page, /params\.append\('district', dist\)/);
  assert.match(page, /signal: controller\.signal/);
  assert.match(page, /marketIllustrativeLabel/);
  assert.match(page, /marketIllustrativeDisclosure/);
  assert.match(page, /marketDatasetLabel/);
  assert.match(page, /list="market-commodity-options"/);
  assert.match(page, /fetchPrices\(searchCommodity, nextState, canonicalDistrict\)/);
  assert.match(page, /results\.disclaimer/);
  assert.doesNotMatch(page, /DEMO reference data, not a live price/);
});

test('assistant UI renders the corrected backend reply text without replacing it with diagnostic metadata', () => {
  const context = source('../context/AssistantContext.tsx');
  const modal = source('../components/KisanAssistantModal.tsx');
  const page = source('../pages/AskKisanHitaPage.tsx');
  assert.match(context, /text: data\.reply_text/);
  assert.match(modal, /msg\.text/);
  assert.match(page, /msg\.text/);
});

test('Weather displays verified location catalogue with state and district selection', () => {
  const page = source('../pages/WeatherPage.tsx');
  assert.match(page, /WEATHER_STATES/);
  assert.match(page, /getWeatherDistrictsForState/);
  assert.match(page, /isWeatherSupportedDistrict/);
  assert.match(page, /resetDistrictForStateChange/);
  assert.match(page, /requestWeather/);
  assert.match(page, /generateDemoForecast/);
  assert.match(page, /localizeLocation\(districtName,\s*language\)/);
  assert.match(page, /localizeLocation\(stateName,\s*language\)/);
  assert.match(page, /weatherDistrictDisclaimer/);
  assert.match(page, /weatherDemoDisclaimer/);
});

test('Weather GPS detects current location and passes coordinates through relative weather API', () => {
  const page = source('../pages/WeatherPage.tsx');
  assert.match(page, /detectCurrentLocation/);
  assert.match(page, /useCurrentLocation/);
  assert.match(page, /detected\.coordinates\.latitude/);
  assert.match(page, /detected\.coordinates\.longitude/);
  assert.match(page, /loadWeather\(\{[\s\S]*?latitude: detected\.coordinates\.latitude[\s\S]*?longitude: detected\.coordinates\.longitude/);
  assert.match(page, /locationPermissionDenied/);
  assert.doesNotMatch(page, /updateProfile/);
});

test('Weather handles manual district changes and resets invalid district on state change', () => {
  const page = source('../pages/WeatherPage.tsx');
  assert.match(page, /resetDistrictForStateChange/);
  assert.match(page, /getWeatherDistrictsForState\(state\)/);
  assert.match(page, /CONDITIONS\[language\]/);
  assert.match(page, /activeFetchRef/);
  assert.match(page, /loadWeather\(\{ district, state \}\)/);
});

test('Assistant input renders one Prisma microphone and never falls back to browser recognition', () => {
  const modal = source('../components/KisanAssistantModal.tsx');
  const context = source('../context/AssistantContext.tsx');
  const micControl = modal.match(/\{\/\* The sole voice-input control records clips for Prisma\. \*\/[\s\S]*?\{\/\* Text Input \*\/\}/)?.[0] || '';
  assert.equal([...micControl.matchAll(/<button/g)].length, 1);
  assert.match(micControl, /prismaEnabled\s*\?/);
  assert.match(micControl, /startPrismaVoiceInput/);
  assert.match(micControl, /disabled=\{isProcessing \|\| !prismaEnabled \|\| !voiceConfigLoaded\}/);
  assert.doesNotMatch(micControl, /\{prismaEnabled &&/);
  assert.match(context, /startPrismaVoiceInput/);
  assert.doesNotMatch(context, /VoiceRecognitionService|startVoiceInput|stopVoiceInput|wakeWord/);
});

test('Market provider is local and the page clearly marks synthetic data', () => {
  const page = source('../pages/MarketPricesPage.tsx');
  const provider = source('../../../backend/app/services/market_provider.py');
  assert.match(provider, /LocalIllustrativeMarketProvider/);
  assert.doesNotMatch(provider, /httpx|data\.gov\.in|DATA_GOV_IN_API_KEY/);
  assert.match(page, /marketIllustrativeDisclosure/);
  assert.match(page, /marketIllustrativeLabel/);
  assert.match(page, /setError\(err\?\.message \|\| t\('marketServiceUnavailable'\)\)/);
  assert.doesNotMatch(page, /marketOfficialDataUnavailable|AGMARKNET|data\.gov\.in/);
});

test('initial answers and Listen again use the same full-response Timbre-aware speech service', async () => {
  const context = source('../context/AssistantContext.tsx');
  const modal = source('../components/KisanAssistantModal.tsx');
  const speechSource = source('../services/speech.ts');

  // Assistant context and modal integration contracts
  assert.match(context, /speakText\(data\.reply_text, options\)/);
  assert.match(modal, /onClick=\{\(\) => speakText\(msg\.text\)\}/);

  // Speech service chunking and Timbre provider verification
  assert.match(speechSource, /splitSpeechText\(cleanText\)/);
  assert.match(speechSource, /\/api\/voice\/config/);
  assert.match(speechSource, /\/api\/voice\/tts/);
  assert.match(speechSource, /timbreEnabled/);
  assert.match(speechSource, /Vasudha/);

  // Runtime verification: SpeechService splits text and sends requests using Timbre
  const { SpeechService } = await import('../services/speech.ts');
  const oldFetch = globalThis.fetch;
  const oldAudio = globalThis.Audio;

  const ttsRequests = [];
  const audioPlays = [];

  class MockAudio {
    constructor(url) {
      this.url = url;
      this.onplay = null;
      this.onended = null;
      this.onerror = null;
      this.paused = true;
    }
    play() {
      audioPlays.push(this.url);
      this.paused = false;
      queueMicrotask(() => {
        this.onplay?.();
        this.paused = true;
        this.onended?.();
      });
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }

  globalThis.Audio = MockAudio;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/config')) {
      return { ok: true, json: async () => ({ timbre_enabled: true }) };
    }
    if (String(url).endsWith('/tts')) {
      const body = JSON.parse(options?.body || '{}');
      ttsRequests.push(body);
      return {
        ok: true,
        json: async () => ({
          audio_base64: 'QUFBQQ=='.repeat(20),
          format: 'audio/wav',
          language: body.language,
          provider: 'gnani_live',
          model: 'timbre-v3.0',
          voice_name: 'Vasudha',
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    let started = false;
    let ended = false;
    await SpeechService.speak(
      'Crop advice sentence one. Crop advice sentence two.',
      'te',
      () => { started = true; },
      () => { ended = true; }
    );

    assert.equal(started, true);
    assert.equal(ended, true);
    assert.ok(ttsRequests.length >= 1);
    assert.equal(ttsRequests[0].language, 'te');
    assert.ok(audioPlays.length >= 1);
  } finally {
    SpeechService.stop();
    globalThis.fetch = oldFetch;
    globalThis.Audio = oldAudio;
  }
});
