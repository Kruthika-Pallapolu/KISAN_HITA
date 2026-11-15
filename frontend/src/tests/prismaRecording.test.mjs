import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  encodeWav,
  getPrismaRecordingExtension,
  PrismaManualRecorder,
  selectPrismaRecordingMime,
  uploadPrismaRecording,
  WebAudioPcmRecorder,
} from '../services/prismaRecording.ts';

test('recording MIME selection probes browser support and rejects Chromium WebM-only support', () => {
  class SafariRecorder {
    static isTypeSupported(type) { return type === 'audio/mp4'; }
  }
  class ChromiumWebmOnlyRecorder {
    static isTypeSupported(type) { return type.startsWith('audio/webm'); }
  }
  assert.equal(selectPrismaRecordingMime(SafariRecorder), 'audio/mp4');
  assert.equal(getPrismaRecordingExtension('audio/mp4;codecs=mp4a.40.2'), 'm4a');
  assert.equal(selectPrismaRecordingMime(ChromiumWebmOnlyRecorder), null);
  assert.equal(getPrismaRecordingExtension('audio/webm;codecs=opus'), null);
  assert.equal(selectPrismaRecordingMime(class MediaRecorderWithoutProbe {}), null);
});

test('Prisma manual recording uses only an API-documented media type and releases the microphone', async () => {
  const oldRecorder = globalThis.MediaRecorder;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let stoppedTracks = 0;
  class FakeMediaRecorder {
    static isTypeSupported(type) { return type === 'audio/mp4'; }
    state = 'inactive';
    constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  const stream = { getTracks: () => [{ stop() { stoppedTracks += 1; } }] };
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: FakeMediaRecorder });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => stream } } });
  try {
    const recorder = new PrismaManualRecorder();
    await recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const result = await recorder.stop();
    assert.equal(result.mimeType, 'audio/mp4');
    assert.equal(result.filename, 'recording.m4a');
    assert.ok(result.durationSeconds > 0);
    assert.equal(stoppedTracks, 1);
  } finally {
    if (oldRecorder === undefined) delete globalThis.MediaRecorder;
    else Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: oldRecorder });
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else delete globalThis.navigator;
  }
});

test('Prisma upload sends the correct manual multipart contract and validates transcript', async () => {
  let request;
  const transcript = await uploadPrismaRecording({
    blob: new Blob(['mock audio'], { type: 'audio/mp4' }),
    mimeType: 'audio/mp4', filename: 'recording.m4a', durationSeconds: 1.2,
  }, 'te', async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ transcript: 'రేపు వర్షం పడుతుందా?' }) };
  });
  assert.equal(request.url, '/api/voice/stt/upload');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.credentials, 'same-origin');
  const form = request.options.body;
  assert.equal(form.get('language'), 'te');
  assert.equal(form.get('duration_seconds'), '1.2');
  assert.equal(form.get('file').name, 'recording.m4a');
  assert.equal(transcript, 'రేపు వర్షం పడుతుందా?');
});

test('Prisma client rejects overlong clips before making a request', async () => {
  let calls = 0;
  await assert.rejects(() => uploadPrismaRecording({
    blob: new Blob(['sample']), mimeType: 'audio/mp4', filename: 'clip.m4a', durationSeconds: 30.1,
  }, 'en', async () => { calls += 1; }), /up to 30 seconds/);
  assert.equal(calls, 0);
});

test('Prisma client rejects a mismatched MIME, filename, or blob type before upload', async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; };
  await assert.rejects(() => uploadPrismaRecording({
    blob: new Blob(['sample'], { type: 'audio/webm' }),
    mimeType: 'audio/webm',
    filename: 'clip.wav',
    durationSeconds: 1,
  }, 'en', fetcher), /format and filename do not match/);
  await assert.rejects(() => uploadPrismaRecording({
    blob: new Blob(['sample'], { type: 'audio/webm' }),
    mimeType: 'audio/mp4',
    filename: 'recording.m4a',
    durationSeconds: 1,
  }, 'en', fetcher), /MIME type does not match/);
  assert.equal(calls, 0);
});

test('Prisma frontend hands only the returned transcript to existing assistant chat without a wake-listener dependency', () => {
  const context = readFileSync(new URL('../context/AssistantContext.tsx', import.meta.url), 'utf8');
  assert.match(context, /uploadPrismaRecording\(recording, language\)/);
  assert.match(context, /sendMessage\(transcript/);
  assert.doesNotMatch(context, /wakeWord|requestWakeMicrophoneYield|returnWakeMicrophone/);
});

test('encodeWav generates a standard 44-byte RIFF WAVE header with correct PCM metadata', async () => {
  const sampleRate = 16000;
  const numSamples = 800; // 50ms of audio
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  const blob = encodeWav(samples, sampleRate);
  assert.equal(blob.type, 'audio/wav');
  assert.equal(blob.size, 44 + numSamples * 2);

  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  const textDecoder = new TextDecoder();

  // Check 'RIFF' and 'WAVE'
  const riff = textDecoder.decode(new Uint8Array(buffer, 0, 4));
  assert.equal(riff, 'RIFF');
  const wave = textDecoder.decode(new Uint8Array(buffer, 8, 4));
  assert.equal(wave, 'WAVE');

  // Check fmt chunk
  const fmt = textDecoder.decode(new Uint8Array(buffer, 12, 4));
  assert.equal(fmt, 'fmt ');
  assert.equal(view.getUint32(16, true), 16); // fmt chunk size
  assert.equal(view.getUint16(20, true), 1);  // PCM format
  assert.equal(view.getUint16(22, true), 1);  // mono
  assert.equal(view.getUint32(24, true), sampleRate); // sample rate
  assert.equal(view.getUint32(28, true), sampleRate * 2); // byte rate
  assert.equal(view.getUint16(32, true), 2);  // block align
  assert.equal(view.getUint16(34, true), 16); // bits per sample

  // Check data chunk
  const dataHeader = textDecoder.decode(new Uint8Array(buffer, 36, 4));
  assert.equal(dataHeader, 'data');
  assert.equal(view.getUint32(40, true), numSamples * 2);
});

test('Chrome & Android Web Audio PCM WAV fallback records valid WAV when MediaRecorder has only WebM', async () => {
  // Simulate Chromium: MediaRecorder exists but only supports audio/webm
  class ChromiumRecorder {
    static isTypeSupported(type) { return type.startsWith('audio/webm'); }
  }

  let audioProcessCb = null;
  let closedContext = false;
  let sourceConnected = false;
  let stoppedTracks = 0;

  class FakeAudioContext {
    sampleRate = 16000;
    destination = {};
    createMediaStreamSource(stream) {
      return {
        connect(target) { sourceConnected = true; },
        disconnect() {},
      };
    }
    createScriptProcessor(bufSize, inCh, outCh) {
      return {
        set onaudioprocess(fn) { audioProcessCb = fn; },
        get onaudioprocess() { return audioProcessCb; },
        connect(target) {},
        disconnect() {},
      };
    }
    close() { closedContext = true; }
  }

  const oldRecorder = globalThis.MediaRecorder;
  const oldAudioContext = globalThis.AudioContext;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  const stream = { getTracks: () => [{ stop() { stoppedTracks += 1; } }] };

  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: ChromiumRecorder });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => stream } } });

  try {
    const recorder = new PrismaManualRecorder();
    await recorder.start();
    assert.ok(sourceConnected);
    assert.ok(typeof audioProcessCb === 'function');

    // Simulate audio data arriving
    const fakeSamples = new Float32Array(400);
    audioProcessCb({
      inputBuffer: {
        getChannelData: () => fakeSamples,
      },
    });

    const result = await recorder.stop();
    assert.equal(result.mimeType, 'audio/wav');
    assert.equal(result.filename, 'recording.wav');
    assert.ok(result.blob.size >= 44);
    assert.equal(stoppedTracks, 1);
    assert.ok(closedContext);
  } finally {
    if (oldRecorder === undefined) delete globalThis.MediaRecorder;
    else Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: oldRecorder });
    if (oldAudioContext === undefined) delete globalThis.AudioContext;
    else Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: oldAudioContext });
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else delete globalThis.navigator;
  }
});

test('weather navigation is restored in Navbar and App routing', () => {
  const navbarContent = readFileSync(new URL('../components/Navbar.tsx', import.meta.url), 'utf8');
  assert.match(navbarContent, /id:\s*'weather'/);
  assert.match(navbarContent, /CloudSun/);

  const appContent = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(appContent, /import\s+.*WeatherPage/);
  assert.match(appContent, /currentTab\s*===\s*'weather'/);
});
