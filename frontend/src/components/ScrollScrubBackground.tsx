import React, { useEffect, useRef } from 'react';
import { clampProgress, getScrollProgress, ScrollScrubRuntime } from '../services/scrollScrub';

const VIDEO_URL = '/assets/kisan-hita-scroll.mp4';
const POSTER_URL = '/assets/kisan-hita-sunset.png';

/** Scroll controls the muted background video; it is never played autonomously. */
export const ScrollScrubBackground: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const veil = veilRef.current;
    if (!video || !veil) return;

    video.defaultMuted = true;
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');

    if (typeof video.load === 'function' && video.readyState === 0) {
      try {
        video.load();
      } catch {
        // Safe fallback
      }
    }

    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mobileQuery = window.matchMedia('(max-width: 760px), (pointer: coarse)');

    const readProgress = () => {
      const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
      const scrollHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        document.documentElement.offsetHeight,
        window.innerHeight
      );
      const innerHeight = window.innerHeight || document.documentElement.clientHeight || 1;
      const progress = getScrollProgress(scrollY, scrollHeight, innerHeight);

      // The original artifact scrubs a charcoal veil over its intro and footer.
      const intro = document.querySelector<HTMLElement>('[data-background-intro]');
      let introOpacity = 0;
      if (intro) {
        const rect = intro.getBoundingClientRect();
        const top = rect.top + scrollY;
        const start = top - innerHeight * 0.8;
        const end = top + rect.height * 0.5 - innerHeight * 0.5;
        introOpacity = clampProgress((scrollY - start) / Math.max(1, end - start)) * 0.34;
      }

      const footer = document.querySelector<HTMLElement>('footer');
      let footerOpacity = 0;
      if (footer) {
        const top = footer.getBoundingClientRect().top + scrollY;
        const start = top - innerHeight;
        const end = top - innerHeight * 0.3;
        const progress = clampProgress((scrollY - start) / Math.max(1, end - start));
        footerOpacity = (intro ? 0.34 : 0) + (0.72 - (intro ? 0.34 : 0)) * progress;
      }
      veil.style.opacity = String(Math.max(introOpacity, footerOpacity));
      return progress;
    };

    const runtime = new ScrollScrubRuntime({
      video,
      events: window,
      visibilityEvents: document,
      isVisible: () => document.visibilityState === 'visible',
      readProgress,
      mobile: () => mobileQuery.matches,
      reducedMotion: () => reducedMotionQuery.matches,
      // The poster remains visible if the asset itself fails to load.
      onUnavailable: () => { video.style.visibility = 'hidden'; },
    });

    const onMediaPreferenceChange = () => runtime.refresh();
    const onViewportResize = () => runtime.refresh();
    const onDocumentScroll = () => runtime.refresh();
    reducedMotionQuery.addEventListener('change', onMediaPreferenceChange);
    mobileQuery.addEventListener('change', onMediaPreferenceChange);
    window.visualViewport?.addEventListener('resize', onViewportResize);
    document.addEventListener('scroll', onDocumentScroll, { passive: true });

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => runtime.refresh())
      : null;
    resizeObserver?.observe(document.documentElement);

    runtime.mount();

    return () => {
      runtime.destroy();
      document.removeEventListener('scroll', onDocumentScroll);
      resizeObserver?.disconnect();
      reducedMotionQuery.removeEventListener('change', onMediaPreferenceChange);
      mobileQuery.removeEventListener('change', onMediaPreferenceChange);
      window.visualViewport?.removeEventListener('resize', onViewportResize);
    };
  }, []);

  return (
    <div className="scroll-scrub-background" aria-hidden="true">
      <video
        ref={videoRef}
        className="scroll-scrub-background__video"
        src={VIDEO_URL}
        poster={POSTER_URL}
        muted
        playsInline
        preload="metadata"
        tabIndex={-1}
      />
      <div className="scroll-scrub-background__scrim" />
      <div ref={veilRef} className="scroll-scrub-background__veil" />
      <div className="scroll-scrub-background__grain" />
    </div>
  );
};
