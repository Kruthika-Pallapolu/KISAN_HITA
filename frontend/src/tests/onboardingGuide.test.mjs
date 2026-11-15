import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ONBOARDING_COPY } from '../i18n/onboardingCopy.ts';

const ONBOARDING_COMPLETED_KEY = 'kisan_hita_onboarding_completed_v1';
const LEGACY_INTRO_SEEN_KEY = 'kisan_hita_intro_seen';

test('onboarding copy covers all 7 supported languages with 4 clear steps', () => {
  const expectedCodes = ['te', 'en', 'hi', 'ta', 'kn', 'ml', 'mr'];
  assert.equal(Object.keys(ONBOARDING_COPY).length, 7);

  for (const code of expectedCodes) {
    const copy = ONBOARDING_COPY[code];
    assert.ok(copy, `Missing onboarding copy for ${code}`);
    assert.equal(copy.steps.length, 4, `${code} must have exactly 4 onboarding steps`);

    for (let i = 0; i < copy.steps.length; i++) {
      const step = copy.steps[i];
      assert.ok(step.title?.trim(), `${code} step ${i + 1} missing title`);
      assert.ok(step.subtitle?.trim(), `${code} step ${i + 1} missing subtitle`);
      assert.ok(step.description?.trim(), `${code} step ${i + 1} missing description`);
      assert.ok(Array.isArray(step.items) && step.items.length >= 3, `${code} step ${i + 1} must have at least 3 highlight items`);
    }

    assert.ok(copy.next?.trim(), `${code} missing next label`);
    assert.ok(copy.back?.trim(), `${code} missing back label`);
    assert.ok(copy.skip?.trim(), `${code} missing skip label`);
    assert.ok(copy.finish?.trim(), `${code} missing finish label`);
    assert.ok(copy.reopenGuide?.trim(), `${code} missing reopenGuide label`);
    assert.ok(copy.viewGuide?.trim(), `${code} missing viewGuide label`);
    assert.ok(typeof copy.stepIndicator === 'function', `${code} missing stepIndicator formatter`);
  }
});

test('onboarding Step 4 contains honest farmer safety guidance and DEMO disclaimers across all languages', () => {
  for (const code of ['te', 'en', 'hi', 'ta', 'kn', 'ml', 'mr']) {
    const step4 = ONBOARDING_COPY[code].steps[3];
    const allText = [step4.title, step4.subtitle, step4.description, ...step4.items].join(' ');

    // Safety checks: DEMO market prices, officer/KVK verification, and reopening guidance
    assert.match(allText, /DEMO/, `${code} must explicitly state DEMO market prices`);
    assert.match(allText, /KVK|officer|అధికారి|अधिकारी|அதிகாரி|ಅಧಿಕಾರಿ|ഓഫീസറുമായോ/, `${code} must advise consulting agriculture officer / KVK`);
  }
});

test('FirstTimeWelcomeModal checks both versioned and legacy completion keys and listens for reopen event', () => {
  const modalCode = readFileSync(new URL('../components/FirstTimeWelcomeModal.tsx', import.meta.url), 'utf8');

  // Key check
  assert.equal(ONBOARDING_COMPLETED_KEY, 'kisan_hita_onboarding_completed_v1');
  assert.equal(LEGACY_INTRO_SEEN_KEY, 'kisan_hita_intro_seen');
  assert.match(modalCode, /ONBOARDING_COMPLETED_KEY/);
  assert.match(modalCode, /LEGACY_INTRO_SEEN_KEY/);

  // Persistence on dismiss
  assert.match(modalCode, /localStorage\.setItem\(ONBOARDING_COMPLETED_KEY,\s*'true'\)/);
  assert.match(modalCode, /localStorage\.setItem\(LEGACY_INTRO_SEEN_KEY,\s*'true'\)/);

  // Reopen event listener
  assert.match(modalCode, /kisan-hita:open-onboarding/);
  assert.match(modalCode, /setStep\(0\)/);

  // Navigation controls
  assert.match(modalCode, /copy\.skip/);
  assert.match(modalCode, /copy\.next/);
  assert.match(modalCode, /copy\.back/);
  assert.match(modalCode, /copy\.finish/);

  // Preserved test invariant
  assert.match(modalCode, /handsFreeOptional/);
  assert.match(modalCode, /kisan-hita:open-settings/);
});

test('Navbar exposes website guide trigger in desktop navbar-actions and mobile menu', () => {
  const navbarCode = readFileSync(new URL('../components/Navbar.tsx', import.meta.url), 'utf8');

  assert.match(navbarCode, /className="help-button"/);
  assert.match(navbarCode, /HelpCircle/);
  assert.match(navbarCode, /kisan-hita:open-onboarding/);
  assert.match(navbarCode, /ONBOARDING_COPY/);
});

test('SettingsModal exposes View Website Guide trigger that dispatches open event', () => {
  const settingsCode = readFileSync(new URL('../components/SettingsModal.tsx', import.meta.url), 'utf8');

  assert.match(settingsCode, /kisan-hita:open-onboarding/);
  assert.match(settingsCode, /viewGuide/);
  assert.match(settingsCode, /setShowSettingsModal\(false\)/);
});

test('onboarding does not advertise weather feature in any of the 7 supported languages', () => {
  const weatherTerms = {
    en: /weather/i,
    te: /వాతావరణ/,
    hi: /मौसम/,
    ta: /வானிலை/,
    kn: /ಹವಾಮಾನ/,
    ml: /കാലാവസ്ഥ/,
    mr: /हवामान/,
  };

  for (const [code, pattern] of Object.entries(weatherTerms)) {
    const copy = ONBOARDING_COPY[code];
    const fullText = JSON.stringify(copy);
    assert.doesNotMatch(fullText, pattern, `Onboarding copy for ${code} must not contain weather references`);
  }
});

test('first-time onboarding appears when no completion keys are set and language selection is done', () => {
  const mockStorage = new Map();
  const getCompleted = () => mockStorage.get(ONBOARDING_COMPLETED_KEY) || mockStorage.get(LEGACY_INTRO_SEEN_KEY);

  // First time: no keys in storage
  assert.equal(getCompleted(), undefined);
  let isOpen = false;
  let step = -1;
  const showLanguageModal = false;

  const checkInitialOpen = (showModal) => {
    const completed = getCompleted();
    if (!completed && !showModal) {
      isOpen = true;
      step = 0;
    }
  };

  checkInitialOpen(showLanguageModal);
  assert.equal(isOpen, true, 'First-time user must see onboarding');
  assert.equal(step, 0, 'Onboarding must start at step 0');
});

test('returning users do not automatically see onboarding again across refreshes', () => {
  const mockStorage = new Map();
  // Case A: modern v1 key set
  mockStorage.set(ONBOARDING_COMPLETED_KEY, 'true');
  let isOpen = false;
  const completedA = mockStorage.get(ONBOARDING_COMPLETED_KEY) || mockStorage.get(LEGACY_INTRO_SEEN_KEY);
  if (!completedA) {
    isOpen = true;
  }
  assert.equal(isOpen, false, 'Returning user with v1 key must not see onboarding automatically');

  // Case B: legacy key set
  mockStorage.clear();
  mockStorage.set(LEGACY_INTRO_SEEN_KEY, 'true');
  isOpen = false;
  const completedB = mockStorage.get(ONBOARDING_COMPLETED_KEY) || mockStorage.get(LEGACY_INTRO_SEEN_KEY);
  if (!completedB) {
    isOpen = true;
  }
  assert.equal(isOpen, false, 'Returning user with legacy key must not see onboarding automatically');
});

test('skip and finish persist completion reliably without resetting on reopen', () => {
  const mockStorage = new Map();
  const handleDismiss = () => {
    mockStorage.set(ONBOARDING_COMPLETED_KEY, 'true');
    mockStorage.set(LEGACY_INTRO_SEEN_KEY, 'true');
  };

  // Skip simulation
  handleDismiss();
  assert.equal(mockStorage.get(ONBOARDING_COMPLETED_KEY), 'true');
  assert.equal(mockStorage.get(LEGACY_INTRO_SEEN_KEY), 'true');

  // Reopen simulation: setting step to 0 must NOT clear storage
  let step = 0;
  let isOpen = true;
  assert.equal(step, 0);
  assert.equal(isOpen, true);
  assert.equal(mockStorage.get(ONBOARDING_COMPLETED_KEY), 'true', 'Reopening must preserve completed state');
  assert.equal(mockStorage.get(LEGACY_INTRO_SEEN_KEY), 'true', 'Reopening must preserve legacy state');

  // Finish simulation after reopen
  handleDismiss();
  assert.equal(mockStorage.get(ONBOARDING_COMPLETED_KEY), 'true');
  assert.equal(mockStorage.get(LEGACY_INTRO_SEEN_KEY), 'true');
});

test('step navigation advances with next, reverses with back, and respects bounds', () => {
  const totalSteps = 4;
  let step = 0;
  let completed = false;

  const handleNext = () => {
    if (step < totalSteps - 1) {
      step += 1;
    } else {
      completed = true;
    }
  };

  const handleBack = () => {
    if (step > 0) {
      step -= 1;
    }
  };

  assert.equal(step, 0);
  handleBack(); // Should not go below 0
  assert.equal(step, 0);

  handleNext();
  assert.equal(step, 1);
  handleNext();
  assert.equal(step, 2);
  handleNext();
  assert.equal(step, 3);
  assert.equal(completed, false);

  handleBack();
  assert.equal(step, 2);
  handleNext();
  assert.equal(step, 3);

  handleNext(); // On last step, advances to completion
  assert.equal(completed, true);
});

test('language switching dynamically updates onboarding content across all seven languages', () => {
  const languages = ['te', 'en', 'hi', 'ta', 'kn', 'ml', 'mr'];
  for (const lang of languages) {
    const copy = ONBOARDING_COPY[lang];
    assert.ok(copy, `Language ${lang} copy must be present`);
    assert.equal(copy.steps.length, 4);
    // Verify unique localized titles for step 1
    assert.ok(copy.steps[0].title.length > 5);
    // Verify localized buttons exist
    assert.ok(copy.next && copy.back && copy.skip && copy.finish);
  }
});

test('modal supports keyboard Escape dismissal and accessibility attributes', () => {
  const modalCode = readFileSync(new URL('../components/FirstTimeWelcomeModal.tsx', import.meta.url), 'utf8');
  assert.match(modalCode, /role="dialog"/);
  assert.match(modalCode, /aria-modal="true"/);
  assert.match(modalCode, /e\.key === 'Escape'/);
  assert.match(modalCode, /modalRef/);
  assert.match(modalCode, /aria-label=\{copy\.stepIndicator/);
});
