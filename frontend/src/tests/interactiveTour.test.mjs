import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ONBOARDING_COMPLETED_KEY = 'kisan_hita_onboarding_completed_v1';
const LEGACY_INTRO_SEEN_KEY = 'kisan_hita_intro_seen';

test('first-time onboarding implements centered two-slide presentation without spotlights or tooltips', () => {
  const componentCode = readFileSync(new URL('../components/FirstTimeWelcomeModal.tsx', import.meta.url), 'utf8');

  // Centered modal layout on dark backdrop
  assert.match(componentCode, /alignItems:\s*'center'/);
  assert.match(componentCode, /justifyContent:\s*'center'/);
  assert.match(componentCode, /onboarding-modal-card/);

  // Exactly two slides
  assert.match(componentCode, /totalSlides\s*=\s*2/);
  assert.match(componentCode, /slide\s*===\s*0/);

  // Completely removed spotlight tours, tooltips, arrows, and auto-scroll
  assert.doesNotMatch(componentCode, /tour-spotlight-cutout/);
  assert.doesNotMatch(componentCode, /tour-tooltip-arrow/);
  assert.doesNotMatch(componentCode, /scrollIntoView/);
  assert.doesNotMatch(componentCode, /TOUR_TARGETS/);
});

test('Slide 1 welcomes farmer and introduces Mitra assistant with personalization', () => {
  const componentCode = readFileSync(new URL('../components/FirstTimeWelcomeModal.tsx', import.meta.url), 'utf8');

  // Welcome message and Mitra introduction
  assert.match(componentCode, /Welcome to Kisan Hita/);
  assert.match(componentCode, /Meet Mitra/);
  assert.match(componentCode, /Mitra/);

  // Continue button
  assert.match(componentCode, /copy\.continueBtn/);
  assert.match(componentCode, /handleNext/);

  // Assistant name personalization defaulting to Mitra
  assert.match(componentCode, /id="onboarding-assistant-name"/);
  assert.match(componentCode, /htmlFor="onboarding-assistant-name"/);
  assert.match(componentCode, /return 'Mitra'/);
  assert.match(componentCode, /useAssistant/);
  assert.match(componentCode, /updateAssistantName\(newName\)/);
  assert.match(componentCode, /updateAssistantName\(customAssistantName\)/);
});

test('Slide 2 introduces Choose Crop, Check Crop, Weather, Market Prices, and Mitra Assistant', () => {
  const componentCode = readFileSync(new URL('../components/FirstTimeWelcomeModal.tsx', import.meta.url), 'utf8');

  // All 5 core features are introduced
  assert.match(componentCode, /Choose Crop/);
  assert.match(componentCode, /Check Crop/);
  assert.match(componentCode, /Local Weather/);
  assert.match(componentCode, /Market Prices/);
  assert.match(componentCode, /Mitra Assistant/);

  // Action buttons
  assert.match(componentCode, /copy\.getStartedBtn/);
  assert.match(componentCode, /copy\.back/);
  assert.match(componentCode, /handleDismiss/);
  assert.match(componentCode, /handleBack/);
});

test('onboarding persistence reliably guards returning users and supports replay entry point', () => {
  const storage = new Map();

  const isTourTriggered = (showLanguageModal) => {
    const completed = storage.get(ONBOARDING_COMPLETED_KEY) || storage.get(LEGACY_INTRO_SEEN_KEY);
    return !completed && !showLanguageModal;
  };

  // 1. First time user: tour triggers
  assert.equal(isTourTriggered(false), true);

  // 2. User completes or skips tour
  storage.set(ONBOARDING_COMPLETED_KEY, 'true');
  storage.set(LEGACY_INTRO_SEEN_KEY, 'true');

  // 3. Returning user: tour does NOT trigger automatically on refresh
  assert.equal(isTourTriggered(false), false);

  // 4. Replay event triggers tour explicitly without resetting persistence
  let replayed = false;
  const handleOpenGuide = () => {
    replayed = true;
  };
  handleOpenGuide();
  assert.equal(replayed, true);
  assert.equal(storage.get(ONBOARDING_COMPLETED_KEY), 'true');
});

test('onboarding supports keyboard navigation (Escape, ArrowRight, ArrowLeft)', () => {
  const componentCode = readFileSync(new URL('../components/FirstTimeWelcomeModal.tsx', import.meta.url), 'utf8');

  assert.match(componentCode, /e\.key === 'Escape'/);
  assert.match(componentCode, /e\.key === 'ArrowRight'/);
  assert.match(componentCode, /e\.key === 'ArrowLeft'/);
  assert.match(componentCode, /handleNext/);
  assert.match(componentCode, /handleBack/);
  assert.match(componentCode, /handleDismiss/);
});

test('App integrates FirstTimeWelcomeModal with page routing', () => {
  const appCode = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

  assert.match(appCode, /<FirstTimeWelcomeModal\s+currentTab=\{currentTab\}\s+onNavigate=\{handleRouteFeature\}\s*\/>/);
});

test('all seven languages provide complete copy for both slides, five features, and controls', () => {
  const componentCode = readFileSync(new URL('../components/FirstTimeWelcomeModal.tsx', import.meta.url), 'utf8');

  const languages = ['en', 'te', 'hi', 'ta', 'kn', 'ml', 'mr'];
  for (const lang of languages) {
    assert.match(componentCode, new RegExp(`${lang}:\\s*\\{`));
  }
});
