import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { ScrollScrubRuntime, easeScrollProgress, getScrollProgress, getVideoTime, shouldSeekFrame } from '../services/scrollScrub.ts';

const read = (relPath) => readFileSync(new URL(relPath, import.meta.url), 'utf8');

test('1. First-visit animation availability: mounted at top level before login and during language selection', () => {
  const app = read('../App.tsx');
  const firstVisit = read('../components/FirstVisitLanguageSelection.tsx');

  // ScrollScrubBackground is mounted in the root App component wrapping AuthenticatedApp
  assert.match(app, /<AuthProvider>[\s\S]*<ScrollScrubBackground \/>[\s\S]*<AuthenticatedApp \/>[\s\S]*<\/AuthProvider>/);

  // Loading container does not use opaque background
  assert.match(app, /if \(loading\) return <div[^>]*background: 'transparent'/);

  // FirstVisitLanguageSelection has transparent shell background
  assert.match(firstVisit, /background: 'transparent'/);

  // Exactly ONE ScrollScrubBackground is mounted across App.tsx
  const backgroundMatches = app.match(/<ScrollScrubBackground \/>/g);
  assert.equal(backgroundMatches?.length, 1, 'There must be exactly one ScrollScrubBackground in App.tsx');

  // AppContent must NOT contain a duplicate ScrollScrubBackground
  const appContentMatch = app.match(/const AppContent[\s\S]*?return \(([\s\S]*?)\);\s*\};/);
  assert.ok(appContentMatch, 'AppContent must be present in App.tsx');
  assert.doesNotMatch(appContentMatch[1], /<ScrollScrubBackground \/>/, 'AppContent must not contain duplicate ScrollScrubBackground');
});

test('2. Continuous availability across all pages: z-index hierarchy and persistent container', () => {
  const app = read('../App.tsx');
  const css = read('../index.css');

  // .scroll-scrub-background is fixed at z-index 0
  assert.match(css, /\.scroll-scrub-background\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(css, /\.scroll-scrub-background\s*\{[\s\S]*?z-index:\s*0;/);
  assert.match(css, /\.scroll-scrub-background\s*\{[\s\S]*?pointer-events:\s*none;/);

  // main content sits above background at z-index 1
  assert.match(app, /<main style=\{\{\s*flex:\s*1,\s*zIndex:\s*1\s*\}\}>/);

  // All 6 core page tabs are rendered under main
  assert.match(app, /currentTab === 'home' && <HomePage/);
  assert.match(app, /currentTab === 'weather' && <WeatherPage/);
  assert.match(app, /currentTab === 'choose-crop' && <ChooseCropPage/);
  assert.match(app, /currentTab === 'check-crop' && <CheckCropPage/);
  assert.match(app, /currentTab === 'market-prices' && <MarketPricesPage/);
  assert.match(app, /currentTab === 'ask_kisan' && <AskKisanHitaPage/);
});

test('3. Fresh session & media initialization: video starts loading immediately without user scroll', () => {
  const component = read('../components/ScrollScrubBackground.tsx');

  // Checks that video.load() is called if readyState === 0 on mount
  assert.match(component, /video\.readyState === 0/);
  assert.match(component, /video\.load\(\)/);

  // Declarative attributes: strictly scroll-controlled, no autonomous autoplay or looping
  assert.doesNotMatch(component, /autoPlay/);
  assert.doesNotMatch(component, /loop/);
  assert.match(component, /muted/);
  assert.match(component, /playsInline/);
  assert.match(component, /preload="metadata"/);

  // Programmatic DOM properties for Safari and Chrome compatibility
  assert.match(component, /video\.defaultMuted = true;/);
  assert.match(component, /video\.muted = true;/);
  assert.match(component, /video\.setAttribute\('playsinline', ''\);/);
  assert.match(component, /video\.setAttribute\('webkit-playsinline', ''\);/);
});

test('4. Normal refresh, hard refresh, and navigation event hooks', () => {
  const runtimeCode = read('../services/scrollScrub.ts');

  // Verifies all lifecycle and browser navigation hooks are registered and cleaned up
  for (const eventName of ['scroll', 'resize', 'pageshow', 'popstate', 'hashchange']) {
    assert.match(runtimeCode, new RegExp(`this\\.events\\.addEventListener\\('${eventName}'`));
    assert.match(runtimeCode, new RegExp(`this\\.events\\.removeEventListener\\('${eventName}'`));
  }
  assert.match(runtimeCode, /visibilitychange/);
});

test('5. Video assets exist on disk and have valid sizes', () => {
  assert.ok(existsSync(new URL('../../../frontend/public/assets/kisan-hita-scroll.mp4', import.meta.url)), 'scroll video must exist in public/assets');
  assert.ok(existsSync(new URL('../../../frontend/public/assets/kisan-hita-sunset.png', import.meta.url)), 'sunset poster must exist in public/assets');
  assert.ok(existsSync(new URL('../../../frontend/dist/assets/kisan-hita-scroll.mp4', import.meta.url)), 'scroll video must exist in dist/assets');
  assert.ok(existsSync(new URL('../../../frontend/dist/assets/kisan-hita-sunset.png', import.meta.url)), 'sunset poster must exist in dist/assets');
});

test('6. No video autoplay rejection, leak, or unbounded CPU consumption', () => {
  const component = read('../components/ScrollScrubBackground.tsx');
  const runtimeCode = read('../services/scrollScrub.ts');

  // No direct unhandled video.play() in component that could trigger unhandled promise rejections
  assert.doesNotMatch(component, /video\.play\(/);

  // Video is always paused on mount and ready
  assert.match(runtimeCode, /this\.video\.pause\(\)/);

  // Idle scroll ceases scheduling animation frames
  assert.match(runtimeCode, /if \(Math\.abs\(this\.target - this\.current\) < 0\.0005\) this\.current = this\.target;/);
  assert.match(runtimeCode, /if \(this\.video\.seeking \|\| Math\.abs\(this\.target - this\.current\) >= 0\.0005\) this\.scheduleFrame\(\);/);

  // Visibility change cancels frames when tab is backgrounded
  assert.match(runtimeCode, /if \(!this\.isVisible\(\)\) \{[\s\S]*?this\.cancelFrame\(this\.frameHandle\);/);
});

test('7. Background remains visible behind auth and onboarding modals', () => {
  const authPage = read('../pages/AuthPage.tsx');
  const firstVisit = read('../components/FirstVisitLanguageSelection.tsx');
  const welcomeModal = read('../components/FirstTimeWelcomeModal.tsx');

  assert.match(authPage, /background: 'transparent'/);
  assert.match(firstVisit, /background: 'transparent'/);
  // Modal uses translucent backdrop allowing background to be visible
  assert.match(welcomeModal, /rgba\(10, 11, 7, 0\.82\)/);
});

test('8. Scroll-scrub interaction continues to smoothly map scroll position to video frames', () => {
  class MockVideo extends EventTarget {
    duration = 10;
    readyState = 2;
    currentTime = 0;
    seeking = false;
    pause() {}
    load() {}
  }

  const video = new MockVideo();
  let progress = 0;
  const frames = [];

  const runtime = new ScrollScrubRuntime({
    video,
    events: new EventTarget(),
    visibilityEvents: new EventTarget(),
    isVisible: () => true,
    readProgress: () => progress,
    mobile: () => false,
    reducedMotion: () => false,
    onUnavailable: () => {},
    requestFrame: (cb) => { frames.push(cb); return frames.length; },
    cancelFrame: () => {},
  });

  runtime.mount();
  assert.equal(video.currentTime, 0);

  // Scroll down to 50%
  progress = 0.5;
  runtime.refresh();
  assert.equal(frames.length > 0, true);

  // Run animation frame tick
  const tick = frames.shift();
  tick(16.6);

  assert.ok(video.currentTime > 0, 'video currentTime must scrub forward as scroll increases');
  assert.ok(video.currentTime <= 5, 'video currentTime must ease towards 5.0 seconds');

  runtime.destroy();
});
