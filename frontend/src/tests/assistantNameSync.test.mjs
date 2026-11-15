import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ASSISTANT_NAME,
  getWakePreferences,
  saveWakePreferences,
} from '../services/wakeWord.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '..');

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    get size() {
      return store.size;
    },
  };
}

test('1. Default assistant name is Mitra when unconfigured', () => {
  const mockStorage = createMockStorage();
  const prefs = getWakePreferences(mockStorage, 'en');
  assert.equal(DEFAULT_ASSISTANT_NAME, 'Mitra');
  assert.equal(prefs.name, 'Mitra');
  assert.equal(prefs.phrase, 'Mitra');
});

test('2. saveWakePreferences writes to storage, mirrors to window storages, and sets configured flag', () => {
  const mockLocal = createMockStorage();
  const mockSession = createMockStorage();

  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: mockLocal,
    sessionStorage: mockSession,
    dispatchEvent: () => {},
  };

  try {
    saveWakePreferences('Keshav', undefined, mockLocal, 'te');

    assert.equal(mockLocal.getItem('kisan_hita_wake_name'), 'Keshav');
    assert.equal(mockLocal.getItem('kisan_hita_wake_name_configured'), 'true');
    assert.equal(mockSession.getItem('kisan_hita_wake_name'), 'Keshav');
    assert.equal(mockSession.getItem('kisan_hita_wake_name_configured'), 'true');

    // All 7 languages get updated
    const langs = ['en', 'te', 'hi', 'ta', 'kn', 'ml', 'mr'];
    for (const lang of langs) {
      assert.equal(mockLocal.getItem(`kisan_hita_wake_phrase_${lang}`), 'Keshav');
      assert.equal(mockSession.getItem(`kisan_hita_wake_phrase_${lang}`), 'Keshav');
    }
  } finally {
    globalThis.window = originalWindow;
  }
});

test('3. Custom assistant name persists across simulated refresh in guest mode without reverting to Mitra', () => {
  const mockLocal = createMockStorage();
  const mockSession = createMockStorage();

  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: mockLocal,
    sessionStorage: mockSession,
    dispatchEvent: () => {},
  };

  try {
    // User sets name to "Chitti"
    saveWakePreferences('Chitti', undefined, mockSession, 'en');

    // Simulate page reload: fresh session reading from storage
    const reloadedPrefsSession = getWakePreferences(mockSession, 'en');
    assert.equal(reloadedPrefsSession.name, 'Chitti');

    const reloadedPrefsLocal = getWakePreferences(mockLocal, 'en');
    assert.equal(reloadedPrefsLocal.name, 'Chitti');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('4. Custom assistant name never silently reverts to Mitra if guest session starts fresh with local storage populated', () => {
  const mockLocal = createMockStorage({
    kisan_hita_wake_name: 'Lakshmi',
    kisan_hita_wake_name_configured: 'true',
  });
  const mockSession = createMockStorage(); // empty guest session

  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: mockLocal,
    sessionStorage: mockSession,
    dispatchEvent: () => {},
  };

  try {
    // getWakePreferences passed mockSession checks fallback mockLocal
    const prefs = getWakePreferences(mockSession, 'en');
    assert.equal(prefs.name, 'Lakshmi');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('5. PersistentAssistantBar displays assistantName from AssistantContext as single source of truth', () => {
  const barCode = fs.readFileSync(path.join(srcDir, 'components', 'PersistentAssistantBar.tsx'), 'utf-8');
  assert.match(barCode, /const\s*\{\s*toggleAssistant,\s*isOpen,\s*assistantName\s*\}\s*=\s*useAssistant\(\);/);
  assert.match(barCode, /\{assistantName\s*\|\|\s*KISAN_HITA_NAME\}/);
});

test('6. AssistantContext provides setAssistantName and binds assistantName to getStoredAssistantName', () => {
  const ctxCode = fs.readFileSync(path.join(srcDir, 'context', 'AssistantContext.tsx'), 'utf-8');
  assert.match(ctxCode, /setAssistantName:\s*\(name:\s*string\)\s*=>\s*void;/);
  assert.match(ctxCode, /getStoredAssistantName\(storage\)/);
  assert.match(ctxCode, /persistAssistantName\(name,\s*storage\)/);
  assert.match(ctxCode, /assistantName,\s*setAssistantName,/);
});

test('7. SettingsModal uses setAssistantName from useAssistant to update assistant name immediately', () => {
  const settingsCode = fs.readFileSync(path.join(srcDir, 'components', 'SettingsModal.tsx'), 'utf-8');
  assert.match(settingsCode, /useAssistant/);
  assert.match(settingsCode, /updateAssistantName\(wakeName\)/);
});

test('8. FirstTimeWelcomeModal uses setAssistantName to update assistant name immediately upon change and finish', () => {
  const tourCode = fs.readFileSync(path.join(srcDir, 'components', 'FirstTimeWelcomeModal.tsx'), 'utf-8');
  assert.match(tourCode, /useAssistant/);
  assert.match(tourCode, /updateAssistantName\(newName\)/);
  assert.match(tourCode, /updateAssistantName\(customAssistantName\)/);
});
