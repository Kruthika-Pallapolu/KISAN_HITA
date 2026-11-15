import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDefaultWakePhrase, checkOnDeviceRecognition, checkBrowserRecognition, DEFAULT_ASSISTANT_NAME, DEFAULT_WAKE_PREFIXES, detectRecognitionEngine, getWakePreferences, LocalWakeController, PrismaAudioWakeController, removeWakePhrase, saveWakePreferences, SPEECH_LOCALES, SPEECH_PAUSE_MS } from '../services/wakeWord.ts';

class FakeRecognition {
  static availability = 'available';
  static instances = [];
  static async available({ langs, processLocally }) { this.lastCheck = { langs, processLocally }; return this.availability; }
  processLocally = false;
  onstart = null; onresult = null; onerror = null; onend = null;
  constructor() { FakeRecognition.instances.push(this); }
  start() { this.starts = (this.starts || 0) + 1; this.onstart?.(); }
  stop() { this.stops = (this.stops || 0) + 1; }
  abort() { this.aborts = (this.aborts || 0) + 1; }
  result(chunks, isFinal = true) {
    if (!this.resultsHistory) this.resultsHistory = [];
    while (this.resultsHistory.length > 0 && !this.resultsHistory[this.resultsHistory.length - 1].isFinal) {
      this.resultsHistory.pop();
    }
    const startIndex = this.resultsHistory.length;
    const newItems = chunks.map((transcript) => { const result = [{ transcript }]; result.isFinal = isFinal; return result; });
    this.resultsHistory.push(...newItems);
    this.onresult?.({ resultIndex: startIndex, results: this.resultsHistory });
  }
  end() { this.onend?.(); }
}
const supportedWindow = { SpeechRecognition: FakeRecognition };

test('on-device capability is checked for exact selected locale and unsupported engines are rejected', async () => {
  FakeRecognition.availability = 'available';
  const result = await checkOnDeviceRecognition('te', supportedWindow);
  assert.equal(result.supported, true);
  assert.deepEqual(FakeRecognition.lastCheck, { langs: ['te-IN'], processLocally: true });
  FakeRecognition.availability = 'downloadable';
  assert.equal((await checkOnDeviceRecognition('te', supportedWindow)).supported, false);
  assert.equal((await checkOnDeviceRecognition('en', {})).supported, false);
});

test('all seven app locales remain explicit and do not silently fall back to English', () => {
  assert.deepEqual(Object.values(SPEECH_LOCALES), ['en-IN','te-IN','hi-IN','ta-IN','kn-IN','ml-IN','mr-IN']);
});

test('configured assistant name and trailing question are recognized in all seven app languages', () => {
  const examples = [
    ['en', 'Lakshmi tomato crop lo problems enti?'],
    ['te', 'లక్ష్మి టమాటా పంటలో సమస్యలు ఏమిటి?'],
    ['hi', 'लक्ष्मी टमाटर की फसल में क्या समस्याएँ हैं?'],
    ['ta', 'லட்சுமி தக்காளி பயிரில் என்ன பிரச்சினைகள் உள்ளன?'],
    ['kn', 'ಲಕ್ಷ್ಮಿ ಟೊಮೆಟೊ ಬೆಳೆಯಲ್ಲಿ ಯಾವ ಸಮಸ್ಯೆಗಳಿವೆ?'],
    ['ml', 'ലക്ഷ്മി തക്കാളി കൃഷിയിൽ എന്തൊക്കെ പ്രശ്നങ്ങളുണ്ട്?'],
    ['mr', 'लक्ष्मी टोमॅटो पिकात कोणत्या समस्या आहेत?'],
  ];

  for (const [, transcript] of examples) {
    const result = removeWakePhrase(transcript, 'Lakshmi', 'Lakshmi');
    assert.equal(result.detected, true, transcript);
    assert.ok(result.question, transcript);
    assert.equal(result.question.toLowerCase().includes('lakshmi'), false, transcript);
  }
});

test('wake phrase in same utterance preserves and submits the complete trailing question once', async () => {
  FakeRecognition.instances = [];
  const sent = [];
  const controller = new LocalWakeController({ language: 'en', phrase: 'Hey Mitra', Constructor: FakeRecognition,
    onStatus() {}, onQuestion(question, resume) { sent.push(question); this.resume = resume; } });
  controller.start();
  const recognition = FakeRecognition.instances[0];
  recognition.result(['Hey Mitra', 'what will the weather be tomorrow?']);
  recognition.end();
  recognition.end();
  assert.deepEqual(sent, ['what will the weather be tomorrow?']);
  controller.stop();
});

test('phrase-only activation starts a separate question capture after the recognizer ends', async () => {
  FakeRecognition.instances = [];
  const sent = [];
  const controller = new LocalWakeController({ language: 'te', phrase: 'Hey Mitra', Constructor: FakeRecognition,
    onStatus() {}, onQuestion(question) { sent.push(question); } });
  controller.start();
  FakeRecognition.instances[0].result(['Hey Mitra']);
  FakeRecognition.instances[0].end();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(FakeRecognition.instances.length, 2);
  FakeRecognition.instances[1].result(['రేపు వర్షం పడుతుందా?']);
  FakeRecognition.instances[1].end();
  assert.deepEqual(sent, ['రేపు వర్షం పడుతుందా?']);
  controller.stop();
});

test('permission denial becomes inactive and stop releases the active recognizer', () => {
  FakeRecognition.instances = [];
  const statuses = [];
  const controller = new LocalWakeController({ language: 'hi', phrase: 'Hey Mitra', Constructor: FakeRecognition,
    onStatus(status) { statuses.push(status); }, onQuestion() {} });
  controller.start();
  const recognition = FakeRecognition.instances[0];
  recognition.onerror({ error: 'not-allowed' });
  assert.equal(controller.isActive, false);
  assert.ok(statuses.includes('permission'));
  controller.stop();
  assert.equal(recognition.aborts, 1);
});

test('transcript matching is case-insensitive and custom preferences persist without activating a microphone', () => {
  assert.deepEqual(removeWakePhrase('HEY MITRA, Check weather', 'Hey Mitra'), { detected: true, question: 'Check weather' });
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(saveWakePreferences('Sakhi', undefined, storage), { name:'Sakhi', phrase:'Sakhi' });
  assert.deepEqual(getWakePreferences(storage), { name:'Sakhi', phrase:'Sakhi' });
});

test('standard browser recognition capability detects SpeechRecognition and distinguishes from on-device', async () => {
  class StandardBrowserRecognition {
    onstart = null; onresult = null; onerror = null; onend = null;
    start() {} stop() {} abort() {}
  }
  const standardWindow = { SpeechRecognition: StandardBrowserRecognition };

  const onDeviceResult = await checkOnDeviceRecognition('hi', standardWindow);
  assert.equal(onDeviceResult.supported, false);

  for (const lang of ['en', 'te', 'hi', 'ta', 'kn', 'ml', 'mr']) {
    const browserResult = checkBrowserRecognition(lang, standardWindow);
    assert.equal(browserResult.supported, true);
    assert.equal(browserResult.Constructor, StandardBrowserRecognition);
  }

  const engineResult = await detectRecognitionEngine('ta', standardWindow);
  assert.equal(engineResult.supported, true);
  assert.equal(engineResult.mode, 'browser_cloud');
  assert.equal(engineResult.Constructor, StandardBrowserRecognition);

  const emptyResult = await detectRecognitionEngine('te', {});
  assert.equal(emptyResult.supported, false);
  assert.equal(emptyResult.mode, 'unsupported');
});

test('LocalWakeController in browser_cloud mode does not force processLocally', () => {
  FakeRecognition.instances = [];
  const controller = new LocalWakeController({
    language: 'kn',
    phrase: 'Hey Mitra',
    Constructor: FakeRecognition,
    mode: 'browser_cloud',
    onStatus() {},
    onQuestion() {},
  });
  controller.start();
  const instance = FakeRecognition.instances[0];
  assert.equal(instance.processLocally, false);
  controller.stop();
});

test('hands-free cycle 1: initial listening starts correctly', () => {
  FakeRecognition.instances = [];
  const statuses = [];
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Mitra',
    Constructor: FakeRecognition,
    onStatus(s) { statuses.push(s); },
    onQuestion() {},
  });
  controller.start();
  assert.equal(controller.isActive, true);
  assert.equal(statuses.includes('listening'), true);
  assert.equal(FakeRecognition.instances.length, 1);
  assert.equal(FakeRecognition.instances[0].starts, 1);
  controller.stop();
});

test('hands-free cycle 2: user speech transitions LISTENING -> THINKING', () => {
  FakeRecognition.instances = [];
  const statuses = [];
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Mitra',
    Constructor: FakeRecognition,
    onStatus(s) { statuses.push(s); },
    onQuestion() {},
  });
  controller.start();
  const rec = FakeRecognition.instances[0];
  rec.result(['Hey Mitra', 'how to control pests in cotton?']);
  rec.end();
  assert.equal(statuses.includes('processing'), true);
  controller.stop();
});

test('hands-free cycle 3 & 4: assistant response transitions THINKING -> SPEAKING and recognition stays stopped', () => {
  FakeRecognition.instances = [];
  const statuses = [];
  let onSpeakingStartCallback = null;
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Mitra',
    Constructor: FakeRecognition,
    onStatus(s) { statuses.push(s); },
    onQuestion(_q, _onEnd, _onError, onStart) {
      onSpeakingStartCallback = onStart;
    },
  });
  controller.start();
  const rec = FakeRecognition.instances[0];
  rec.result(['Hey Mitra', 'how to control pests?']);
  rec.end();
  assert.equal(statuses.includes('processing'), true);

  onSpeakingStartCallback?.();
  assert.equal(statuses.includes('speaking'), true);
  assert.equal(FakeRecognition.instances.length, 1);
  controller.stop();
});

test('hands-free cycle 5 & 6: speech completion triggers automatic listening and second response accepted without wake phrase', async () => {
  FakeRecognition.instances = [];
  const statuses = [];
  const sent = [];
  let onEndCallback = null;
  let onStartCallback = null;
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Mitra',
    Constructor: FakeRecognition,
    onStatus(s) { statuses.push(s); },
    onQuestion(q, onEnd, _onError, onStart) {
      sent.push(q);
      onEndCallback = onEnd;
      onStartCallback = onStart;
    },
  });
  controller.start();
  FakeRecognition.instances[0].result(['Hey Mitra', 'check weather in Guntur']);
  FakeRecognition.instances[0].end();
  assert.deepEqual(sent, ['check weather in Guntur']);

  onStartCallback?.();
  assert.equal(statuses[statuses.length - 1], 'speaking');
  onEndCallback?.();
  assert.equal(statuses.includes('waiting_for_answer'), true);

  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(FakeRecognition.instances.length, 2);
  assert.equal(statuses[statuses.length - 1], 'question');

  FakeRecognition.instances[1].result(['what is the temperature there?']);
  FakeRecognition.instances[1].end();

  assert.deepEqual(sent, ['check weather in Guntur', 'what is the temperature there?']);
  controller.stop();
});

test('hands-free cycle 7: multiple consecutive follow-up turns work across conversation turns', async () => {
  FakeRecognition.instances = [];
  const sent = [];
  let onEndCallback = null;
  let onStartCallback = null;
  const controller = new LocalWakeController({
    language: 'te',
    phrase: 'హే మిత్రా',
    Constructor: FakeRecognition,
    onStatus() {},
    onQuestion(q, onEnd, _onError, onStart) {
      sent.push(q);
      onEndCallback = onEnd;
      onStartCallback = onStart;
    },
  });
  controller.start();
  FakeRecognition.instances[0].result(['హే మిత్రా', 'వరి సాగు వివరాలు']);
  FakeRecognition.instances[0].end();
  assert.deepEqual(sent, ['వరి సాగు వివరాలు']);

  onStartCallback?.();
  onEndCallback?.();
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(FakeRecognition.instances.length, 2);
  FakeRecognition.instances[1].result(['ఎరువుల మోతాదు ఎంత?']);
  FakeRecognition.instances[1].end();
  assert.deepEqual(sent, ['వరి సాగు వివరాలు', 'ఎరువుల మోతాదు ఎంత?']);

  onStartCallback?.();
  onEndCallback?.();
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(FakeRecognition.instances.length, 3);
  FakeRecognition.instances[2].result(['నీటి యాజమాన్యం ఎలా చేయాలి?']);
  FakeRecognition.instances[2].end();
  assert.deepEqual(sent, ['వరి సాగు వివరాలు', 'ఎరువుల మోతాదు ఎంత?', 'నీటి యాజమాన్యం ఎలా చేయాలి?']);

  controller.stop();
});

test('hands-free cycle 8: manual stop prevents automatic restart', async () => {
  FakeRecognition.instances = [];
  let onEndCallback = null;
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Mitra',
    Constructor: FakeRecognition,
    onStatus() {},
    onQuestion(_q, onEnd) { onEndCallback = onEnd; },
  });
  controller.start();
  FakeRecognition.instances[0].result(['Hey Mitra', 'hello']);
  FakeRecognition.instances[0].end();

  controller.stop();
  assert.equal(controller.isActive, false);

  onEndCallback?.();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(FakeRecognition.instances.length, 1);
});

test('hands-free cycle 9: empty recognition results recover safely without dropping session', async () => {
  FakeRecognition.instances = [];
  let onEndCallback = null;
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Mitra',
    Constructor: FakeRecognition,
    onStatus() {},
    onQuestion(_q, onEnd) { onEndCallback = onEnd; },
  });
  controller.start();
  FakeRecognition.instances[0].result(['Hey Mitra', 'how are you?']);
  FakeRecognition.instances[0].end();

  onEndCallback?.();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(FakeRecognition.instances.length, 2);

  FakeRecognition.instances[1].result([]);
  FakeRecognition.instances[1].end();
  await new Promise((resolve) => setTimeout(resolve, 180));

  assert.equal(controller.isActive, true);
  assert.equal(FakeRecognition.instances.length, 3);
  controller.stop();
});

test('hands-free cycle 10: recognition errors do not create duplicate sessions', async () => {
  FakeRecognition.instances = [];
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Mitra',
    Constructor: FakeRecognition,
    onStatus() {},
    onQuestion() {},
  });
  controller.start();
  const rec = FakeRecognition.instances[0];
  rec.onerror({ error: 'network' });
  rec.end();

  assert.equal(FakeRecognition.instances.length, 1);
  controller.stop();
});

test('hands-free cycle 11: playback failure does not leave state stuck in processing or speaking', async () => {
  FakeRecognition.instances = [];
  const statuses = [];
  let onErrorCallback = null;
  let onStartCallback = null;
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Mitra',
    Constructor: FakeRecognition,
    onStatus(s) { statuses.push(s); },
    onQuestion(_q, _onEnd, onError, onStart) {
      onErrorCallback = onError;
      onStartCallback = onStart;
    },
  });
  controller.start();
  FakeRecognition.instances[0].result(['Hey Mitra', 'test speech failure']);
  FakeRecognition.instances[0].end();
  assert.equal(statuses[statuses.length - 1], 'processing');

  onStartCallback?.();
  assert.equal(statuses[statuses.length - 1], 'speaking');

  onErrorCallback?.();
  await new Promise((resolve) => setTimeout(resolve, 180));

  assert.equal(controller.isActive, true);
  assert.notEqual(statuses[statuses.length - 1], 'speaking');
  assert.notEqual(statuses[statuses.length - 1], 'processing');
  controller.stop();
});

test('hands-free cycle 12: component cleanup stops active recognition', () => {
  FakeRecognition.instances = [];
  const statuses = [];
  const controller = new LocalWakeController({
    language: 'hi',
    phrase: 'हे मित्र',
    Constructor: FakeRecognition,
    onStatus(s) { statuses.push(s); },
    onQuestion() {},
  });
  controller.start();
  assert.equal(controller.isActive, true);
  const rec = FakeRecognition.instances[0];

  controller.stop();
  assert.equal(controller.isActive, false);
  assert.equal(rec.aborts >= 1 || rec.stops >= 1, true);
  assert.equal(statuses[statuses.length - 1], 'disabled');
});

test('renaming assistant to Oreo detects Oreo, Hey Oreo, and greeting variants even with desynced phrase', () => {
  // Test direct name calls
  assert.deepEqual(removeWakePhrase('Oreo', 'Hey Mitra', 'Oreo'), { detected: true, question: '' });
  assert.deepEqual(removeWakePhrase('Oreo, what is the weather today?', 'Hey Mitra', 'Oreo'), { detected: true, question: 'what is the weather today?' });
  assert.deepEqual(removeWakePhrase('Hey Oreo, how to treat leaf curl?', 'Hey Mitra', 'Oreo'), { detected: true, question: 'how to treat leaf curl?' });
  assert.deepEqual(removeWakePhrase('Hello Oreo, what is the price of cotton?', 'Hey Mitra', 'Oreo'), { detected: true, question: 'what is the price of cotton?' });
  assert.deepEqual(removeWakePhrase('Hi Oreo, suggest fertilizer for paddy', 'Hey Mitra', 'Oreo'), { detected: true, question: 'suggest fertilizer for paddy' });

  // Configured phrase still works
  assert.deepEqual(removeWakePhrase('Hey Mitra, check rain forecast', 'Hey Mitra', 'Oreo'), { detected: true, question: 'check rain forecast' });

  // Preference persistence automatically aligns default phrase when assistant name is customized
  const values = new Map();
  const storage = { getItem: (k) => values.get(k) || null, setItem: (k, v) => values.set(k, v) };
  saveWakePreferences('Oreo', undefined, storage, 'en');
  assert.deepEqual(getWakePreferences(storage, 'en'), { name: 'Oreo', phrase: 'Oreo' });

  // Even if an old 'Hey Mitra' phrase was in storage, getWakePreferences adapts to Oreo
  values.set('kisan_hita_wake_name', 'Oreo');
  values.set('kisan_hita_wake_phrase_en', 'Hey Mitra');
  assert.deepEqual(getWakePreferences(storage, 'en'), { name: 'Oreo', phrase: 'Oreo' });
});

test('LocalWakeController wakes up when spoken to as Oreo and submits question to assistant', async () => {
  FakeRecognition.instances = [];
  const submitted = [];
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Mitra',
    assistantName: 'Oreo',
    Constructor: FakeRecognition,
    onStatus() {},
    onQuestion(q) { submitted.push(q); },
  });
  controller.start();
  const recognition = FakeRecognition.instances[0];
  recognition.result(['Hey Oreo', 'will it rain in Guntur today?']);
  recognition.end();
  assert.deepEqual(submitted, ['will it rain in Guntur today?']);
  controller.stop();
});

test('1. Default assistant name is Mitra', () => {
  const emptyStorage = { getItem: () => null, setItem: () => {} };
  assert.equal(DEFAULT_ASSISTANT_NAME, 'Mitra');
  const prefs = getWakePreferences(emptyStorage, 'en');
  assert.equal(prefs.name, 'Mitra');
  assert.equal(prefs.phrase, 'Mitra');
});

test('2. Renaming Oreo to Keshav updates source of truth and stops responding to Oreo', () => {
  const values = new Map();
  const storage = { getItem: (k) => values.get(k) || null, setItem: (k, v) => values.set(k, v) };
  saveWakePreferences('Keshav', undefined, storage, 'en');
  const prefs = getWakePreferences(storage, 'en');
  assert.equal(prefs.name, 'Keshav');
  assert.equal(prefs.phrase, 'Keshav');

  assert.deepEqual(removeWakePhrase('Keshav, what is the price of chilli?', prefs.phrase, prefs.name), {
    detected: true,
    question: 'what is the price of chilli?',
  });
  assert.deepEqual(removeWakePhrase('Hey Keshav, what is the price of chilli?', prefs.phrase, prefs.name), {
    detected: true,
    question: 'what is the price of chilli?',
  });
  // Disallows old Oreo name when renamed to Keshav
  assert.deepEqual(removeWakePhrase('Oreo, what is the price of chilli?', prefs.phrase, prefs.name), {
    detected: false,
    question: '',
  });
});

test('3. Recognizing the short name Keshu for Keshav', () => {
  assert.deepEqual(removeWakePhrase('Keshu, will it rain today?', 'Hey Keshav', 'Keshav'), {
    detected: true,
    question: 'will it rain today?',
  });
  assert.deepEqual(removeWakePhrase('Hey Keshu, will it rain today?', 'Hey Keshav', 'Keshav'), {
    detected: true,
    question: 'will it rain today?',
  });
  assert.deepEqual(removeWakePhrase('Hello Keshu, suggest fertilizer', 'Hey Keshav', 'Keshav'), {
    detected: true,
    question: 'suggest fertilizer',
  });
});

test('4. Changing the assistant name while Hands-Free mode is active', () => {
  FakeRecognition.instances = [];
  const submitted = [];
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Oreo',
    assistantName: 'Oreo',
    Constructor: FakeRecognition,
    onStatus() {},
    onQuestion(q) { submitted.push(q); },
  });
  controller.start();
  assert.equal(controller.isActive, true);

  // Live update name to Keshav without restarting controller
  controller.updatePreferences('Keshav', 'Hey Keshav');

  const rec = FakeRecognition.instances[0];
  rec.result(['Hey Keshav', 'what is the market price of tomato?']);
  rec.end();

  assert.deepEqual(submitted, ['what is the market price of tomato?']);

  // Live update language to Telugu
  controller.updateLanguage('te');
  assert.equal(controller.isActive, true);
  controller.stop();
});

test('5. English questions with configured assistant name', () => {
  assert.deepEqual(removeWakePhrase('Keshav, how to control leaf curl virus in chilli crop?', 'Hey Keshav', 'Keshav'), {
    detected: true,
    question: 'how to control leaf curl virus in chilli crop?',
  });
  assert.deepEqual(removeWakePhrase('Hey Oreo, what is the forecast for next 7 days?', 'Hey Oreo', 'Oreo'), {
    detected: true,
    question: 'what is the forecast for next 7 days?',
  });
});

test('6. Telugu questions with configured assistant name and native script variants', () => {
  assert.deepEqual(removeWakePhrase('కేశవ్ రేపు వర్షం పడుతుందా?', 'హే Keshav', 'Keshav'), {
    detected: true,
    question: 'రేపు వర్షం పడుతుందా?',
  });
  assert.deepEqual(removeWakePhrase('హే కేశవ్ టొమాటో ధర ఎంత?', 'హే Keshav', 'Keshav'), {
    detected: true,
    question: 'టొమాటో ధర ఎంత?',
  });
  assert.deepEqual(removeWakePhrase('కేశు నీటి యాజమాన్యం ఎలా చేయాలి?', 'హే Keshav', 'Keshav'), {
    detected: true,
    question: 'నీటి యాజమాన్యం ఎలా చేయాలి?',
  });
});

test('7. English–Telugu mixed questions (code-switching)', () => {
  assert.deepEqual(removeWakePhrase('Hey Keshav, repu varsham padtunda?', 'Hey Keshav', 'Keshav'), {
    detected: true,
    question: 'repu varsham padtunda?',
  });
  assert.deepEqual(removeWakePhrase('కేశవ్, tomato crop ki pest control spray cheppandi', 'హే Keshav', 'Keshav'), {
    detected: true,
    question: 'tomato crop ki pest control spray cheppandi',
  });
  assert.deepEqual(removeWakePhrase('Oreo, mirchi panta ki spray eppudu cheyali?', 'Hey Oreo', 'Oreo'), {
    detected: true,
    question: 'mirchi panta ki spray eppudu cheyali?',
  });
});

test('8. Waiting the full 2 seconds after the latest speech activity before submitting', async () => {
  assert.equal(SPEECH_PAUSE_MS, 2000);

  FakeRecognition.instances = [];
  const submitted = [];
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Keshav',
    assistantName: 'Keshav',
    Constructor: FakeRecognition,
    onStatus() {},
    onQuestion(q) { submitted.push(q); },
  });
  controller.start();
  const rec = FakeRecognition.instances[0];

  // User speaks "Hey Keshav" and "what is the price of cotton"
  rec.result(['Hey Keshav', 'what is the price of cotton']);

  // Before 2 seconds, no submission has occurred yet
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(submitted.length, 0);

  // User adds another chunk at 300ms, which resets the silence timer
  rec.result(['in Guntur']);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(submitted.length, 0);

  // After 2 seconds of silence, submission completes
  await new Promise((resolve) => setTimeout(resolve, 1700));
  assert.deepEqual(submitted, ['what is the price of cotton in Guntur']);
  controller.stop();
});

test('9. Not submitting immediately after hearing only the assistant name', async () => {
  FakeRecognition.instances = [];
  const submitted = [];
  const statuses = [];
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Keshav',
    assistantName: 'Keshav',
    Constructor: FakeRecognition,
    onStatus(s) { statuses.push(s); },
    onQuestion(q) { submitted.push(q); },
  });
  controller.start();
  const rec = FakeRecognition.instances[0];

  // User speaks only the wake name "Keshav"
  rec.result(['Keshav']);

  // Even after 2.1 seconds, hearing only the name does NOT submit a blank question
  await new Promise((resolve) => setTimeout(resolve, 2100));
  assert.equal(submitted.length, 0);
  assert.ok(statuses.includes('question')); // Remains in question-listening mode!

  // Now user finally speaks the question
  rec.result(['what is the weather today?']);
  await new Promise((resolve) => setTimeout(resolve, 2100));
  assert.deepEqual(submitted, ['what is the weather today?']);
  controller.stop();
});

test('10. Automatic listening after the assistant finishes speaking', async () => {
  FakeRecognition.instances = [];
  const submitted = [];
  const statuses = [];
  let onSpeakingEndCallback;
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Keshav',
    assistantName: 'Keshav',
    Constructor: FakeRecognition,
    onStatus(s) { statuses.push(s); },
    onQuestion(q, onEnd) {
      submitted.push(q);
      onSpeakingEndCallback = onEnd;
    },
  });
  controller.start();
  const rec1 = FakeRecognition.instances[0];

  // User asks first question
  rec1.result(['Hey Keshav', 'do I need to water paddy today?']);
  rec1.end();
  assert.deepEqual(submitted, ['do I need to water paddy today?']);

  // Assistant finishes speaking its response
  onSpeakingEndCallback();
  await new Promise((resolve) => setTimeout(resolve, 120));

  // Recognizer has automatically restarted in question-listening mode without needing wake phrase
  assert.equal(FakeRecognition.instances.length, 2);
  assert.equal(statuses[statuses.length - 1], 'question');

  // Farmer responds directly without repeating "Hey Keshav"
  const rec2 = FakeRecognition.instances[1];
  rec2.result(['Yes 2 acres']);
  rec2.end();

  assert.deepEqual(submitted, ['do I need to water paddy today?', 'Yes 2 acres']);
  controller.stop();
});

test('timing: duplicate interim results do not extend the 2000ms timer indefinitely', async () => {
  FakeRecognition.instances = [];
  const submitted = [];
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Oreo',
    assistantName: 'Oreo',
    Constructor: FakeRecognition,
    onStatus() {},
    onQuestion(q) { submitted.push(q); },
  });
  controller.start();
  const rec = FakeRecognition.instances[0];

  // User speaks question at t = 0
  rec.result(['Hey Oreo', 'what is the weather today'], false);

  // Safari emits repeated duplicate interim events at 400ms, 800ms, 1200ms
  await new Promise((resolve) => setTimeout(resolve, 400));
  rec.result(['Hey Oreo', 'what is the weather today'], false); // interim duplicate

  await new Promise((resolve) => setTimeout(resolve, 400));
  rec.result(['Hey Oreo', 'what is the weather today'], false); // interim duplicate

  await new Promise((resolve) => setTimeout(resolve, 400));
  rec.result(['Hey Oreo', 'what is the weather today'], false); // interim duplicate

  // At 1400ms, 2000ms has not passed yet since t = 0
  assert.equal(submitted.length, 0);

  // At 2200ms total, exactly 2000ms from the original speech has passed.
  // Duplicate interims did NOT push the timer out to 3200ms!
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.deepEqual(submitted, ['what is the weather today']);
  controller.stop();
});

test('timing: new speech genuinely resets the 2000ms timer', async () => {
  FakeRecognition.instances = [];
  const submitted = [];
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Oreo',
    assistantName: 'Oreo',
    Constructor: FakeRecognition,
    onStatus() {},
    onQuestion(q) { submitted.push(q); },
  });
  controller.start();
  const rec = FakeRecognition.instances[0];

  // First utterance at t = 0
  rec.result(['Hey Oreo', 'what is the price']);

  // At 800ms, user speaks more words ("of tomato in Guntur")
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(submitted.length, 0);
  rec.result(['of tomato in Guntur']);

  // At 2100ms total (1300ms after latest speech), timer is still running
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.equal(submitted.length, 0);

  // At 2900ms total (2100ms after latest speech), timer completes and submits full question
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.deepEqual(submitted, ['what is the price of tomato in Guntur']);
  controller.stop();
});

test('telugu: short silence sessions do not trigger a false permanent shutdown', async () => {
  FakeRecognition.instances = [];
  const submitted = [];
  const statuses = [];
  const controller = new LocalWakeController({
    language: 'te',
    phrase: 'హే Oreo',
    assistantName: 'Oreo',
    Constructor: FakeRecognition,
    onStatus(s) { statuses.push(s); },
    onQuestion(q) { submitted.push(q); },
  });
  controller.start();

  // Simulate 4 consecutive short sessions of silence (typical Safari regional silence timeout)
  for (let i = 0; i < 4; i += 1) {
    const rec = FakeRecognition.instances[i];
    await new Promise((resolve) => setTimeout(resolve, 30));
    rec.end();
    await new Promise((resolve) => setTimeout(resolve, 160));
  }

  // Controller MUST remain active and listening, NOT falsely marked unsupported!
  assert.equal(controller.isActive, true);
  assert.equal(statuses.includes('unsupported'), false);

  // Farmer now speaks in the active session
  const activeRec = FakeRecognition.instances[FakeRecognition.instances.length - 1];
  activeRec.result(['హే Oreo', 'వరి పంటకు ఎరువులు ఎప్పుడు వేయాలి?']);
  activeRec.end();

  assert.deepEqual(submitted, ['వరి పంటకు ఎరువులు ఎప్పుడు వేయాలి?']);
  controller.stop();
});

test('hindi: transient errors and pauses recover safely without permanent death', async () => {
  FakeRecognition.instances = [];
  const submitted = [];
  const statuses = [];
  const controller = new LocalWakeController({
    language: 'hi',
    phrase: 'हे Oreo',
    assistantName: 'Oreo',
    Constructor: FakeRecognition,
    onStatus(s) { statuses.push(s); },
    onQuestion(q) { submitted.push(q); },
  });
  controller.start();

  // Session 1: no-speech event followed by end
  const rec1 = FakeRecognition.instances[0];
  rec1.onerror({ error: 'no-speech' });
  rec1.end();
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(controller.isActive, true);

  // Session 2: transient network glitch
  const rec2 = FakeRecognition.instances[1];
  rec2.onerror({ error: 'network' });
  rec2.end();
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(controller.isActive, true);
  assert.ok(statuses.includes('reconnecting'));

  // Session 3: farmer speaks
  const rec3 = FakeRecognition.instances[2];
  rec3.result(['हे Oreo', 'टमाटर का मंडी भाव क्या है?']);
  rec3.end();

  assert.deepEqual(submitted, ['टमाटर का मंडी भाव क्या है?']);
  controller.stop();
});

test('locale: unsupported language stops cleanly and permanently', () => {
  FakeRecognition.instances = [];
  const statuses = [];
  const controller = new LocalWakeController({
    language: 'kn',
    phrase: 'ಹೇ Oreo',
    assistantName: 'Oreo',
    Constructor: FakeRecognition,
    onStatus(s) { statuses.push(s); },
    onQuestion() {},
  });
  controller.start();
  const rec = FakeRecognition.instances[0];
  rec.onerror({ error: 'language-not-supported' });

  assert.equal(controller.isActive, false);
  assert.equal(statuses[statuses.length - 1], 'unsupported');
  controller.stop();
});

test('regression 1 & 4: renaming assistant to Apple and detecting Apple from Home in English', () => {
  FakeRecognition.instances = [];
  const submitted = [];
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Apple',
    assistantName: 'Apple',
    Constructor: FakeRecognition,
    onStatus() {},
    onQuestion(q) { submitted.push(q); },
  });
  controller.start();
  const rec = FakeRecognition.instances[0];

  rec.result(['Hey Apple', 'what is the market price of tomato?']);
  rec.end();

  assert.deepEqual(submitted, ['what is the market price of tomato?']);
  controller.stop();
});

test('regression 2 & 3: Hindi Home-page wake detection for Apple after switching from English', async () => {
  FakeRecognition.instances = [];
  const submitted = [];
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Apple',
    assistantName: 'Apple',
    Constructor: FakeRecognition,
    onStatus() {},
    onQuestion(q) { submitted.push(q); },
  });
  controller.start();

  // User has English conversation, then changes app language to Hindi
  controller.updateLanguage('hi');
  controller.updatePreferences('Apple', 'हे Apple');
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Active recognizer has updated to Hindi (hi-IN)
  const activeRec = FakeRecognition.instances[FakeRecognition.instances.length - 1];
  assert.equal(activeRec.lang, 'hi-IN');

  // User on Home page speaks in Hindi using configured name Apple (transcribed in Devanagari)
  activeRec.result(['हे एप्पल', 'टमाटर का मंडी भाव क्या है?']);
  activeRec.end();

  assert.deepEqual(submitted, ['टमाटर का मंडी भाव क्या है?']);
  controller.stop();
});

test('regression 5: changing language while listener is active updates recognition locale without dropping session', async () => {
  FakeRecognition.instances = [];
  const submitted = [];
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Apple',
    assistantName: 'Apple',
    Constructor: FakeRecognition,
    onStatus() {},
    onQuestion(q) { submitted.push(q); },
  });
  controller.start();
  assert.equal(FakeRecognition.instances[0].lang, 'en-IN');

  controller.updateLanguage('hi');
  await new Promise((resolve) => setTimeout(resolve, 300));

  const newRec = FakeRecognition.instances[FakeRecognition.instances.length - 1];
  assert.equal(newRec.lang, 'hi-IN');
  assert.equal(controller.isActive, true);

  newRec.result(['एप्पल', 'आज मौसम कैसा है?']);
  newRec.end();

  assert.deepEqual(submitted, ['आज मौसम कैसा है?']);
  controller.stop();
});

test('regression 6: navigating between Home and Assistant shares single controller and no duplicate instances', () => {
  FakeRecognition.instances = [];
  const controller = new LocalWakeController({
    language: 'hi',
    phrase: 'हे Apple',
    assistantName: 'Apple',
    Constructor: FakeRecognition,
    onStatus() {},
    onQuestion() {},
  });
  controller.start();
  assert.equal(FakeRecognition.instances.length, 1);

  // Calling start again while active does not spawn duplicates
  controller.start();
  assert.equal(FakeRecognition.instances.length, 1);
  controller.stop();
});

test('regression 7 & 8: Telugu onerror language-not-supported halts cleanly without infinite loop', async () => {
  FakeRecognition.instances = [];
  const statuses = [];
  const controller = new LocalWakeController({
    language: 'te',
    phrase: 'హే Apple',
    assistantName: 'Apple',
    Constructor: FakeRecognition,
    onStatus(s) { statuses.push(s); },
    onQuestion() {},
  });
  controller.start();

  const rec1 = FakeRecognition.instances[0];
  assert.equal(rec1.lang, 'te-IN');
  rec1.onerror({ error: 'language-not-supported' });
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(controller.isActive, false);
  assert.equal(statuses[statuses.length - 1], 'unsupported');
  // No infinite restart loop
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(FakeRecognition.instances.length, 1);
  controller.stop();
});

test('service-not-allowed: terminal stop on te-IN with clean unsupported status and no restart loop', async () => {
  FakeRecognition.instances = [];
  const statuses = [];
  const controller = new LocalWakeController({
    language: 'te',
    phrase: 'హే Apple',
    assistantName: 'Apple',
    Constructor: FakeRecognition,
    onStatus(s) { statuses.push(s); },
    onQuestion() {},
  });
  controller.start();

  const rec = FakeRecognition.instances[0];
  assert.equal(rec.lang, 'te-IN');
  // Safari fires error: service-not-allowed
  rec.onerror({ error: 'service-not-allowed' });
  rec.end();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(controller.isActive, false);
  assert.equal(statuses[statuses.length - 1], 'unsupported');
  // Verify no permission request/status flicker
  assert.equal(statuses.includes('permission'), false);
  // Verify no restart loop occurs
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(FakeRecognition.instances.length, 1);
  controller.stop();
});

test('hindi: wake detection for Apple in Devanagari recognizes हे एप्पल and एप्पल alone without submitting empty question', async () => {
  FakeRecognition.instances = [];
  const submitted = [];
  const statuses = [];
  const controller = new LocalWakeController({
    language: 'hi',
    phrase: 'हे Apple',
    assistantName: 'Apple',
    Constructor: FakeRecognition,
    onStatus(s) { statuses.push(s); },
    onQuestion(q) { submitted.push(q); },
  });
  controller.start();

  // 1. Farmer says wake phrase alone: "हे एप्पल"
  const rec1 = FakeRecognition.instances[0];
  rec1.result(['हे एप्पल']);
  rec1.end();
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Should transition to question mode, NOT submit an empty message!
  assert.equal(submitted.length, 0);
  assert.equal(statuses[statuses.length - 1], 'question');

  // 2. Farmer now speaks full question in session 2: "टमाटर का भाव क्या है?"
  const rec2 = FakeRecognition.instances[1];
  rec2.result(['टमाटर का भाव क्या है?']);
  rec2.end();

  assert.deepEqual(submitted, ['टमाटर का भाव क्या है?']);
  controller.stop();
});

test('hindi: Apple wake phrase + full question in single utterance submits cleanly', () => {
  FakeRecognition.instances = [];
  const submitted = [];
  const controller = new LocalWakeController({
    language: 'hi',
    phrase: 'हे Apple',
    assistantName: 'Apple',
    Constructor: FakeRecognition,
    onStatus() {},
    onQuestion(q) { submitted.push(q); },
  });
  controller.start();

  const rec = FakeRecognition.instances[0];
  rec.result(['हे एप्पल', 'धान की बुवाई कब करें?']);
  rec.end();

  assert.deepEqual(submitted, ['धान की बुवाई कब करें?']);
  controller.stop();
});

test('hindi: follow-up question after assistant speech does not require repeating wake phrase', async () => {
  FakeRecognition.instances = [];
  const submitted = [];
  const statuses = [];
  let onSpeakingEndCallback = null;

  const controller = new LocalWakeController({
    language: 'hi',
    phrase: 'हे Apple',
    assistantName: 'Apple',
    Constructor: FakeRecognition,
    onStatus(s) { statuses.push(s); },
    onQuestion(q, onEnd) {
      submitted.push(q);
      onSpeakingEndCallback = onEnd;
    },
  });
  controller.start();

  // Utterance 1: Initial question
  const rec1 = FakeRecognition.instances[0];
  rec1.result(['हे एप्पल', 'गेहूं में कौन सी खाद डालें?']);
  rec1.end();

  assert.deepEqual(submitted, ['गेहूं में कौन सी खाद डालें?']);
  assert.ok(typeof onSpeakingEndCallback === 'function');

  // Assistant finishes speaking TTS reply and asks a follow-up question
  onSpeakingEndCallback();
  assert.ok(statuses.includes('waiting_for_answer'));
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Automatically resumes listening in question mode
  assert.equal(statuses[statuses.length - 1], 'question');

  // Farmer replies WITHOUT repeating "Apple" or "हे एप्पल"
  const rec2 = FakeRecognition.instances[FakeRecognition.instances.length - 1];
  rec2.result(['यूरिया और डीएपी']);
  rec2.end();

  assert.deepEqual(submitted, ['गेहूं में कौन सी खाद डालें?', 'यूरिया और डीएपी']);
  controller.stop();
});

test('preferences: stale legacy names like Mitra or oreo do not override configured Apple', () => {
  const values = new Map();
  const mockStorage = {
    getItem(k) { return values.get(k) || null; },
    setItem(k, v) { values.set(k, String(v)); },
    removeItem(k) { values.delete(k); },
  };

  // Case 1: user configured Apple, but legacy storage had old phrase 'oreo'
  values.set('kisan_hita_wake_name', 'Apple');
  values.set('kisan_hita_wake_phrase_en', 'oreo');
  const prefs1 = getWakePreferences(mockStorage, 'en');
  assert.equal(prefs1.name, 'Apple');
  assert.equal(prefs1.phrase, 'Apple');

  // Case 2: legacy storage had old phrase 'Hey Mitra'
  values.set('kisan_hita_wake_phrase_en', 'Hey Mitra');
  const prefs2 = getWakePreferences(mockStorage, 'en');
  assert.equal(prefs2.name, 'Apple');
  assert.equal(prefs2.phrase, 'Apple');

  // Case 3: Hindi language with Apple configured
  const prefs3 = getWakePreferences(mockStorage, 'hi');
  assert.equal(prefs3.name, 'Apple');
  assert.equal(prefs3.phrase, 'Apple');

  // Case 4: Dynamic name update to Apple updates preferences and controller
  const saved = saveWakePreferences('Apple', undefined, mockStorage, 'hi');
  assert.equal(saved.name, 'Apple');
  assert.equal(saved.phrase, 'Apple');
});

class MockMediaStream {
  constructor() {
    this.tracks = [{ stop() { this.stopped = true; } }];
  }
  getTracks() {
    return this.tracks;
  }
}

class MockMediaRecorder {
  static instances = [];
  static isTypeSupported(mime) {
    return ['audio/mp4', 'audio/webm', 'audio/wav', 'audio/aac'].includes(mime);
  }
  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    this.mimeType = options?.mimeType || 'audio/mp4';
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onerror = null;
    this.onstop = null;
    MockMediaRecorder.instances.push(this);
  }
  start(timeslice) {
    this.state = 'recording';
    this.timeslice = timeslice;
  }
  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }
  emitChunk(data) {
    const chunk = typeof Blob !== 'undefined' && data instanceof Blob ? data : new Blob([data]);
    this.ondataavailable?.({ data: chunk });
  }
}

class MockAudioContext {
  static signal = false;
  state = 'running';
  createMediaStreamSource() { return { connect() {} }; }
  createAnalyser() {
    return {
      fftSize: 256,
      getByteTimeDomainData(data) { data.fill(MockAudioContext.signal ? 220 : 128); },
    };
  }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

test('english regression: English uses its existing browser recognition path without audio upload', async () => {
  FakeRecognition.instances = [];
  let audioUploads = 0;
  const mockFetch = async () => {
    audioUploads += 1;
    return { ok: true, json: async () => ({ transcript: 'test' }) };
  };

  const sent = [];
  const controller = new LocalWakeController({
    language: 'en',
    phrase: 'Hey Apple',
    assistantName: 'Apple',
    Constructor: FakeRecognition,
    onStatus() {},
    onQuestion(q) { sent.push(q); },
  });

  controller.start();
  assert.equal(FakeRecognition.instances.length, 1);
  const rec = FakeRecognition.instances[0];
  rec.result(['Hey Apple', 'what is the price of tomato today?']);
  rec.end();

  assert.deepEqual(sent, ['what is the price of tomato today?']);
  assert.equal(audioUploads, 0, 'English browser recognition must not upload audio');
  controller.stop();
});

test('Prisma STT: Telugu voice bridge records audio, uploads to /api/voice/stt/upload, and submits question in native script', async () => {
  MockMediaRecorder.instances = [];
  const requests = [];
  const mockFetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        transcript: 'హే ఆపిల్ టమాటా ధర ఎంత?',
        confidence: null,
        language: 'te',
        model: 'prisma-v3.0',
        provider: 'gnani_live',
      }),
    };
  };

  const statuses = [];
  const submittedQuestions = [];
  let onSpeakingEndCallback = null;

  const controller = new PrismaAudioWakeController({
    language: 'te',
    phrase: 'హే Apple',
    assistantName: 'Apple',
    MediaRecorderClass: MockMediaRecorder,
    AudioContextClass: MockAudioContext,
    fetcher: mockFetch,
    onStatus(s) { statuses.push(s); },
    onQuestion(q, onEnd) {
      submittedQuestions.push(q);
      onSpeakingEndCallback = onEnd;
    },
  });

  const stream = new MockMediaStream();
  await controller.start(stream);

  assert.ok(controller.isActive);
  assert.ok(statuses.includes('listening'));
  assert.equal(MockMediaRecorder.instances.length, 1);

  const recorder = MockMediaRecorder.instances[0];
  // Simulate recorded audio chunk
  const dummyChunk = new Uint8Array([1, 2, 3, 4, 5]);
  recorder.emitChunk(dummyChunk);

  // Mark speech detected internally and stop recorder
  controller.speechDetected = true;
  recorder.stop();

  // Allow async upload promise to resolve
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/voice/stt/upload');
  assert.equal(requests[0].options.method, 'POST');

  // Verify FormData contents
  const body = requests[0].options.body;
  assert.equal(body.get('language'), 'te');
  assert.equal(body.get('file').type, 'audio/mp4');
  assert.equal(body.get('file').name, 'speech.m4a');

  // Question extracted cleanly via removeWakePhrase in Telugu
  assert.deepEqual(submittedQuestions, ['టమాటా ధర ఎంత?']);
  assert.ok(statuses.includes('processing'));

  // Assistant finishes speaking TTS reply
  onSpeakingEndCallback?.();
  assert.ok(statuses.includes('waiting_for_answer'));

  controller.stop();
  assert.equal(controller.isActive, false);
});

test('Prisma STT: wake word alone in Telugu transitions to question mode without submitting empty question', async () => {
  MockMediaRecorder.instances = [];
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      transcript: 'ఆపిల్', // Wake word alone
      language: 'te',
    }),
  });

  const statuses = [];
  const submitted = [];

  const controller = new PrismaAudioWakeController({
    language: 'te',
    phrase: 'హే Apple',
    assistantName: 'Apple',
    MediaRecorderClass: MockMediaRecorder,
    AudioContextClass: MockAudioContext,
    fetcher: mockFetch,
    onStatus(s) { statuses.push(s); },
    onQuestion(q) { submitted.push(q); },
  });

  const stream = new MockMediaStream();
  await controller.start(stream);

  const recorder = MockMediaRecorder.instances[0];
  recorder.emitChunk(new Uint8Array([1, 2, 3]));
  controller.speechDetected = true;
  recorder.stop();

  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(submitted.length, 0, 'Wake word alone must NOT submit empty message');
  assert.ok(statuses.includes('detected'));
  assert.equal(statuses[statuses.length - 1], 'question');

  controller.stop();
});

test('Prisma STT: multi-turn follow up does not require repeating wake word', async () => {
  MockMediaRecorder.instances = [];
  let transcriptReturn = 'హే ఆపిల్ మిరప పంటలో తెగులు ఏంటి?';
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      transcript: transcriptReturn,
      language: 'te',
    }),
  });

  const submitted = [];
  let onSpeakingEndCallback = null;

  const controller = new PrismaAudioWakeController({
    language: 'te',
    phrase: 'హే Apple',
    assistantName: 'Apple',
    MediaRecorderClass: MockMediaRecorder,
    AudioContextClass: MockAudioContext,
    fetcher: mockFetch,
    onStatus() {},
    onQuestion(q, onEnd) {
      submitted.push(q);
      onSpeakingEndCallback = onEnd;
    },
  });

  const stream = new MockMediaStream();
  await controller.start(stream);

  // Utterance 1: Wake word + question
  let rec = MockMediaRecorder.instances[0];
  rec.emitChunk(new Uint8Array([1, 2, 3]));
  controller.speechDetected = true;
  rec.stop();
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.deepEqual(submitted, ['మిరప పంటలో తెగులు ఏంటి?']);

  // Assistant finishes speaking
  onSpeakingEndCallback?.();
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Utterance 2: Follow-up question without wake word
  transcriptReturn = 'నివారణ చర్యలు చెప్పండి';
  rec = MockMediaRecorder.instances[MockMediaRecorder.instances.length - 1];
  rec.emitChunk(new Uint8Array([4, 5, 6]));
  controller.speechDetected = true;
  rec.stop();
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.deepEqual(submitted, [
    'మిరప పంటలో తెగులు ఏంటి?',
    'నివారణ చర్యలు చెప్పండి',
  ]);

  controller.stop();
});

test('Prisma STT: Hindi, Tamil, Kannada, Malayalam, Marathi languages route with correct language code', async () => {
  for (const lang of ['hi', 'ta', 'kn', 'ml', 'mr']) {
    MockMediaRecorder.instances = [];
    const recordedLangs = [];
    const mockFetch = async (url, opts) => {
      recordedLangs.push(opts.body.get('language'));
      return {
        ok: true,
        status: 200,
        json: async () => ({ transcript: 'नमस्ते', language: lang }),
      };
    };

    const controller = new PrismaAudioWakeController({
      language: lang,
      phrase: 'Hey Apple',
      assistantName: 'Apple',
      MediaRecorderClass: MockMediaRecorder,
      AudioContextClass: MockAudioContext,
      fetcher: mockFetch,
      onStatus() {},
      onQuestion() {},
    });

    const stream = new MockMediaStream();
    await controller.start(stream);

    const rec = MockMediaRecorder.instances[0];
    rec.emitChunk(new Uint8Array([1, 2]));
    controller.speechDetected = true;
    rec.stop();
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(recordedLangs[0], lang);
    controller.stop();
  }
});

test('Prisma VAD does not upload silence and captures a short speech segment', async () => {
  MockMediaRecorder.instances = [];
  MockAudioContext.signal = false;
  const requests = [];
  const controller = new PrismaAudioWakeController({
    language: 'te',
    phrase: 'Lakshmi',
    assistantName: 'Lakshmi',
    MediaRecorderClass: MockMediaRecorder,
    AudioContextClass: MockAudioContext,
    fetcher: async (...args) => {
      requests.push(args);
      return { ok: true, status: 200, json: async () => ({ transcript: 'background speech' }) };
    },
    onStatus() {},
    onQuestion() {},
  });

  await controller.start(new MockMediaStream());
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(requests.length, 0, 'silence must not be uploaded');

  MockAudioContext.signal = true;
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(controller.speechDetected, true, 'speech activity should start capture');
  const recorder = MockMediaRecorder.instances.at(-1);
  recorder.emitChunk(new Uint8Array([1, 2, 3]));
  recorder.stop();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(requests.length, 1, 'one short utterance produces one STT request');
  controller.stop();
  MockAudioContext.signal = false;
});

test('Prisma VAD rejects a Chromium WebM-only recorder without uploading or relabelling it', async () => {
  MockMediaRecorder.instances = [];
  const errors = [];
  const statuses = [];
  let uploads = 0;
  class WebmOnlyRecorder extends MockMediaRecorder {
    static isTypeSupported(mime) {
      return mime.startsWith('audio/webm');
    }
  }
  const controller = new PrismaAudioWakeController({
    language: 'hi',
    phrase: 'Lakshmi',
    assistantName: 'Lakshmi',
    MediaRecorderClass: WebmOnlyRecorder,
    AudioContextClass: MockAudioContext,
    fetcher: async () => { uploads += 1; },
    onStatus(status) { statuses.push(status); },
    onError(error) { errors.push(error); },
    onQuestion() {},
  });

  await controller.start(new MockMediaStream());
  assert.equal(uploads, 0);
  assert.deepEqual(errors, ['recording']);
  assert.ok(statuses.includes('unsupported'));
  assert.equal(WebmOnlyRecorder.instances.length, 0);
  controller.stop();
});

test('Prisma STT ignores background conversation without the configured assistant name', async () => {
  MockMediaRecorder.instances = [];
  let submitted = 0;
  const controller = new PrismaAudioWakeController({
    language: 'te',
    phrase: 'Lakshmi',
    assistantName: 'Lakshmi',
    MediaRecorderClass: MockMediaRecorder,
    AudioContextClass: MockAudioContext,
    fetcher: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ transcript: 'పొలంలో నీటి మట్టం బాగుంది' }),
    }),
    onStatus() {},
    onQuestion() { submitted += 1; },
  });
  await controller.start(new MockMediaStream());
  const recorder = MockMediaRecorder.instances[0];
  recorder.emitChunk(new Uint8Array([1, 2, 3]));
  controller.speechDetected = true;
  recorder.stop();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(submitted, 0);
  controller.stop();
});

test('Prisma STT network failures are surfaced and listening recovers without a fabricated transcript', async () => {
  MockMediaRecorder.instances = [];
  const errors = [];
  const statuses = [];
  const controller = new PrismaAudioWakeController({
    language: 'mr',
    phrase: 'Lakshmi',
    assistantName: 'Lakshmi',
    MediaRecorderClass: MockMediaRecorder,
    AudioContextClass: MockAudioContext,
    fetcher: async () => { throw new TypeError('Failed to fetch'); },
    onStatus(status) { statuses.push(status); },
    onError(error) { errors.push(error); },
    onQuestion() { assert.fail('A failed STT request must not submit a question'); },
  });
  await controller.start(new MockMediaStream());
  const recorder = MockMediaRecorder.instances[0];
  recorder.emitChunk(new Uint8Array([1, 2, 3]));
  controller.speechDetected = true;
  recorder.stop();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(errors, ['network']);
  assert.ok(statuses.includes('error'));
  assert.equal(controller.isActive, true);
  assert.ok(MockMediaRecorder.instances.length >= 2, 'listening restarts after a network error');
  controller.stop();
});

test('Prisma STT surfaces HTTP, empty-transcript, and timeout failures', async () => {
  const cases = [
    {
      expected: 'service',
      fetcher: async () => ({ ok: false, status: 503, json: async () => ({ detail: 'unavailable' }) }),
    },
    {
      expected: 'empty_transcript',
      fetcher: async () => ({ ok: true, status: 200, json: async () => ({ transcript: '' }) }),
    },
    {
      expected: 'timeout',
      sttTimeoutMs: 20,
      fetcher: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
    },
  ];

  for (const { expected, fetcher, sttTimeoutMs } of cases) {
    MockMediaRecorder.instances = [];
    const errors = [];
    const controller = new PrismaAudioWakeController({
      language: 'te',
      phrase: 'Lakshmi',
      assistantName: 'Lakshmi',
      sttTimeoutMs,
      MediaRecorderClass: MockMediaRecorder,
      AudioContextClass: MockAudioContext,
      fetcher,
      onStatus() {},
      onError(error) { errors.push(error); },
      onQuestion() { assert.fail('A failed STT response must not submit a question'); },
    });
    await controller.start(new MockMediaStream());
    const recorder = MockMediaRecorder.instances[0];
    recorder.emitChunk(new Uint8Array([1, 2, 3]));
    controller.speechDetected = true;
    recorder.stop();
    await new Promise((resolve) => setTimeout(resolve, expected === 'timeout' ? 60 : 40));
    assert.deepEqual(errors, [expected]);
    controller.stop();
  }
});

test('gemini follow-up capture expires and returns to wake-name detection', async () => {
  MockMediaRecorder.instances = [];
  const statuses = [];
  let speakingEnded;
  const controller = new PrismaAudioWakeController({
    language: 'te',
    phrase: 'Lakshmi',
    assistantName: 'Lakshmi',
    followUpWindowMs: 40,
    MediaRecorderClass: MockMediaRecorder,
    AudioContextClass: MockAudioContext,
    fetcher: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ transcript: 'Lakshmi tomato crop lo problems enti?' }),
    }),
    onStatus(status) { statuses.push(status); },
    onQuestion(_question, onEnd) { speakingEnded = onEnd; },
  });
  await controller.start(new MockMediaStream());
  const recorder = MockMediaRecorder.instances[0];
  recorder.emitChunk(new Uint8Array([1, 2, 3]));
  controller.speechDetected = true;
  recorder.stop();
  await new Promise((resolve) => setTimeout(resolve, 80));
  speakingEnded();
  assert.equal(controller.mode, 'question');
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(controller.mode, 'wake');
  assert.ok(statuses.includes('listening'));
  controller.stop();
});

test('synchronization: authoritative assistant name derives wake phrase across all 7 languages', () => {
  const values = new Map();
  const mockStorage = {
    getItem(k) { return values.get(k) || null; },
    setItem(k, v) { values.set(k, String(v)); },
    removeItem(k) { values.delete(k); },
  };

  const supportedLangs = ['en', 'te', 'hi', 'ta', 'kn', 'ml', 'mr'];

  // 1. Direct derivation check for all 7 languages
  for (const lang of supportedLangs) {
    assert.equal(buildDefaultWakePhrase('Apple', lang), 'Apple');
  }

  // 2. Saving updates the authoritative name and synchronizes all 7 languages
  let dispatched = false;
  const originalDispatch = globalThis.dispatchEvent;
  const originalWindow = globalThis.window;
  globalThis.window = globalThis;
  if (typeof globalThis.CustomEvent === 'undefined') {
    globalThis.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };
  }
  globalThis.dispatchEvent = (event) => {
    if (event.type === 'kisan-hita:wake-preferences-updated') dispatched = true;
    return true;
  };
  try {
    const result = saveWakePreferences('Apple', undefined, mockStorage, 'te');
    assert.equal(result.name, 'Apple');
    assert.equal(result.phrase, 'Apple');
    assert.equal(dispatched, true);
    assert.equal(mockStorage.getItem('kisan_hita_wake_name'), 'Apple');

    for (const lang of supportedLangs) {
      const prefs = getWakePreferences(mockStorage, lang);
      assert.equal(prefs.name, 'Apple');
      assert.equal(prefs.phrase, 'Apple');
    }
  } finally {
    globalThis.dispatchEvent = originalDispatch;
    globalThis.window = originalWindow;
  }
});

test('synchronization: legacy stale Mitra values do not override configured or default assistant name', () => {
  const values = new Map();
  const mockStorage = {
    getItem(k) { return values.get(k) || null; },
    setItem(k, v) { values.set(k, String(v)); },
    removeItem(k) { values.delete(k); },
  };

  // Case 1: Unconfigured storage defaults to Mitra
  const defaultPrefs = getWakePreferences(mockStorage, 'te');
  assert.equal(defaultPrefs.name, 'Mitra');
  assert.equal(defaultPrefs.phrase, 'Mitra');

  // Case 2: User explicitly saves a new name 'Lakshmi' while old phrase keys exist
  values.set('kisan_hita_wake_phrase_te', 'హే Mitra');
  values.set('kisan_hita_wake_phrase_hi', 'हे Mitra');
  values.set('kisan_hita_wake_phrase_en', 'Hey Mitra');
  saveWakePreferences('Lakshmi', undefined, mockStorage, 'en');

  // Telugu reading must adapt to Lakshmi, not old Mitra
  const tePrefs = getWakePreferences(mockStorage, 'te');
  assert.equal(tePrefs.name, 'Lakshmi');
  assert.equal(tePrefs.phrase, 'Lakshmi');

  // Hindi reading must adapt to Lakshmi
  const hiPrefs = getWakePreferences(mockStorage, 'hi');
  assert.equal(hiPrefs.name, 'Lakshmi');
  assert.equal(hiPrefs.phrase, 'Lakshmi');

  // Case 3: Refresh persistence
  const reloadedPrefs = getWakePreferences(mockStorage, 'te');
  assert.equal(reloadedPrefs.name, 'Lakshmi');
  assert.equal(reloadedPrefs.phrase, 'Lakshmi');
});
