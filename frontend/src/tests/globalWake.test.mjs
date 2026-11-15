import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('optional local wake assistant is capability-gated and wired without touching Prisma input', () => {
  const app = read('../App.tsx');
  const assistant = read('../components/KisanAssistantModal.tsx');
  const settings = read('../components/SettingsModal.tsx');
  const wake = read('../services/wakeWord.ts');
  const widget = read('../components/HandsFreeAssistant.tsx');
  assert.match(app, /<HandsFreeAssistant\s*\/>/);
  assert.match(widget, /checkOnDeviceRecognition/);
  assert.match(widget, /sendMessage\(question/);
  assert.match(settings, /handsFreePhrase/);
  assert.match(wake, /processLocally\s*=\s*true/);
  assert.match(wake, /available\(\{ langs: \[SPEECH_LOCALES\[language\]\], processLocally: true \}\)/);
  assert.equal(existsSync(new URL('../components/HeyKisanVoiceMode.tsx', import.meta.url)), false);
  assert.doesNotMatch(widget, /webkitSpeechRecognition|SpeechRecognition/);
});

test('text assistant remains and the sole microphone control is Prisma input', () => {
  const assistant = read('../components/KisanAssistantModal.tsx');
  const context = read('../context/AssistantContext.tsx');
  const askPage = read('../pages/AskKisanHitaPage.tsx');
  assert.match(assistant, /handleSubmit/);
  assert.match(assistant, /startPrismaVoiceInput/);
  assert.match(context, /PrismaManualRecorder/);
  assert.match(context, /uploadPrismaRecording\(recording, language\)/);
  assert.doesNotMatch(context, /VoiceRecognitionService|startVoiceInput|stopVoiceInput/);
  assert.doesNotMatch(askPage, /<Mic|startVoiceInput|stopVoiceInput/);
});

test('Hands-free Assistant expandable panel stays expanded upon selecting options and collapses only on explicit close or toggle', () => {
  const widget = read('../components/HandsFreeAssistant.tsx');
  // Panel expansion is controlled and bounded to isExpanded state
  assert.match(widget, /const\s*\[isExpanded,\s*setIsExpanded\]\s*=\s*useState\(false\)/);
  assert.match(widget, /<details[\s\S]*?open=\{isExpanded\}[\s\S]*?onToggle=\{/);
  // Clicks inside the panel stop propagation so selecting options does not bubble to toggle
  assert.match(widget, /className="hands-free-panel"[\s\S]*?onClick=\{\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\);/);
  // Options (start/stop, fallback text, settings) do not collapse the panel
  assert.match(widget, /onClick=\{\(\)\s*=>\s*void\s*start\(\)\}/);
  assert.match(widget, /onClick=\{stop\}/);
  assert.match(widget, /onClick=\{\(\)\s*=>\s*openAssistant\(\)\}/);
  assert.match(widget, /onClick=\{\(\)\s*=>\s*\{\s*window\.dispatchEvent\(new CustomEvent\('kisan-hita:open-settings'\)\);/);
  // Explicit close button is available to collapse the panel directly
  assert.match(widget, /className="hands-free-close-btn"[\s\S]*?onClick=\{\(\)\s*=>\s*setIsExpanded\(false\)\}/);
});
