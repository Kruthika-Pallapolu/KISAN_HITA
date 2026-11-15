import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Settings2, MessageSquare, ShieldAlert, Check, X } from 'lucide-react';
import { useAssistant } from '../context/AssistantContext';
import { useLanguage } from '../context/LanguageContext';
import { SupportedLanguage } from '../i18n/translations';
import {
  checkOnDeviceRecognition,
  checkBrowserRecognition,
  getWakePreferences,
  LocalWakeController,
  PrismaAudioWakeController,
  requestMicrophoneAccess,
  logWakeDiagnostic,
  SPEECH_LOCALES,
  type RecognitionEngineMode,
  type WakeStatus,
} from '../services/wakeWord';

const BROWSER_LIMITATION_TITLE: Record<SupportedLanguage, string> = {
  en: 'Browser Speech Limitation',
  te: 'ఈ బ్రౌజర్‌లో మాట గుర్తింపు పరిమితి',
  hi: 'ब्राउज़र में आवाज़ पहचान की सीमा',
  ta: 'உலாவி பேச்சு அறிதல் வரம்பு',
  kn: 'ಬ್ರೌಸರ್ ಧ್ವನಿ ಗುರುತಿಸುವಿಕೆ ಮಿತಿ',
  ml: 'ബ്രൗസർ ശബ്ദ തിരിച്ചറിയൽ പരിമിതി',
  mr: 'ब्राउझर आवाज ओळख मर्यादा',
};

const STATUS_KEY: Record<WakeStatus, string> = {
  disabled: 'handsFreeDisabled',
  suspended: 'handsFreeForegroundSuspended',
  permission: 'handsFreePermissionRequired',
  listening: 'handsFreeListening',
  question: 'handsFreeQuestion',
  processing: 'handsFreeProcessing',
  speaking: 'handsFreeSpeaking',
  reconnecting: 'handsFreeRestarting',
  unsupported: 'handsFreeUnsupported',
  error: 'handsFreeError',
  detected: 'handsFreeDetected',
  waiting_for_answer: 'handsFreeWaitingForAnswer',
};

export const HandsFreeAssistant: React.FC = () => {
  const { language, t } = useLanguage();
  const { openAssistant, sendMessage, stopSpeaking, isSpeaking } = useAssistant();
  const [status, setStatus] = useState<WakeStatus>('disabled');
  const [engineMode, setEngineMode] = useState<RecognitionEngineMode | null>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [errorMessageKey, setErrorMessageKey] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [phrase, setPhrase] = useState(() => getWakePreferences(localStorage, language).phrase);
  const [assistantName, setAssistantName] = useState(() => getWakePreferences(localStorage, language).name);
  const controller = useRef<LocalWakeController | PrismaAudioWakeController | null>(null);
  const languageRef = useRef(language);

  useEffect(() => {
    const syncPreferences = () => {
      const prefs = getWakePreferences(localStorage, language);
      setPhrase(prefs.phrase);
      setAssistantName(prefs.name);
      if (controller.current) {
        controller.current.updatePreferences(prefs.name, prefs.phrase);
      }
    };
    syncPreferences();
    window.addEventListener('kisan-hita:wake-preferences-updated', syncPreferences);
    window.addEventListener('storage', syncPreferences);
    return () => {
      window.removeEventListener('kisan-hita:wake-preferences-updated', syncPreferences);
      window.removeEventListener('storage', syncPreferences);
    };
  }, [language]);

  useEffect(() => {
    if (languageRef.current !== language) {
      const wasActive = Boolean(controller.current?.isActive);
      languageRef.current = language;
      const prefs = getWakePreferences(localStorage, language);
      setPhrase(prefs.phrase);
      setAssistantName(prefs.name);
      if (wasActive) {
        if (isSpeaking) {
          stopSpeaking();
        }
        controller.current?.stop();
        controller.current = null;
        void start();
      }
    }
  }, [language]);

  useEffect(() => {
    const suspend = () => {
      if (document.visibilityState === 'hidden') {
        if (isSpeaking) {
          stopSpeaking();
        }
        controller.current?.stop();
        controller.current = null;
        setStatus('suspended');
        setShowConsent(false);
      }
    };
    document.addEventListener('visibilitychange', suspend);
    window.addEventListener('pagehide', suspend);
    return () => {
      document.removeEventListener('visibilitychange', suspend);
      window.removeEventListener('pagehide', suspend);
    };
  }, [isSpeaking, stopSpeaking]);

  useEffect(() => () => { controller.current?.stop(); }, []);

  const startListening = (Constructor: any, mode: RecognitionEngineMode) => {
    const prefs = getWakePreferences(localStorage, language);
    setPhrase(prefs.phrase);
    setAssistantName(prefs.name);
    logWakeDiagnostic('start_listening_init', { mode, language, phrase: prefs.phrase, name: prefs.name });
    if (controller.current) {
      controller.current.stop();
      controller.current = null;
    }
    const instance = new LocalWakeController({
      language,
      phrase: prefs.phrase,
      assistantName: prefs.name,
      Constructor,
      mode,
      onStatus: (next) => {
        logWakeDiagnostic('status_transition', { status: next });
        setStatus(next);
        if ((next === 'permission' || next === 'error' || next === 'unsupported') && controller.current && !controller.current.isActive) {
          controller.current = null;
        }
      },
      onQuestion: (question, onSpeakingEnd, onSpeakingError, onSpeakingStart) => {
        logWakeDiagnostic('forward_question_to_assistant', { question });
        openAssistant();
        void sendMessage(question, undefined, {
          onSpeakingStart: () => {
            logWakeDiagnostic('assistant_speech_start');
            onSpeakingStart?.();
          },
          onSpeakingEnd: () => {
            logWakeDiagnostic('assistant_speech_end');
            onSpeakingEnd?.();
          },
          onSpeakingError: () => {
            logWakeDiagnostic('assistant_speech_error');
            onSpeakingError?.();
          },
        });
      },
    });
    controller.current = instance;
    instance.start();
  };

  const start = async () => {
    if (controller.current && controller.current.isActive) return;
    setErrorMessageKey('');
    logWakeDiagnostic('start_clicked', { language, locale: SPEECH_LOCALES[language] });

    const mic = await requestMicrophoneAccess();
    if (!mic.granted) {
      setErrorMessageKey(mic.error === 'NotFoundError' ? 'handsFreeErrorNoMicrophone' : 'handsFreeErrorPermission');
      setStatus(mic.error === 'NotFoundError' ? 'error' : 'permission');
      return;
    }

    // Check if live Prisma calls are explicitly authorized by server configuration
    let prismaLiveAuthorized = false;
    if (language !== 'en') {
      try {
        const configRes = await fetch('/api/voice/config', { credentials: 'same-origin' });
        if (configRes.ok) {
          const config = await configRes.json();
          prismaLiveAuthorized = Boolean(config?.prisma_enabled && config?.allow_paid_live_calls);
        }
      } catch {
        prismaLiveAuthorized = false;
      }
    }

    // Indic languages: if Prisma live calls are explicitly authorized, use Prisma v3.0
    if (language !== 'en' && prismaLiveAuthorized) {
      setEngineMode('prisma_multilingual');
      setShowConsent(false);
      if (controller.current) {
        controller.current.stop();
        controller.current = null;
      }
      const prefs = getWakePreferences(localStorage, language);
      setPhrase(prefs.phrase);
      setAssistantName(prefs.name);

      const prismaInstance = new PrismaAudioWakeController({
        language,
        phrase: prefs.phrase,
        assistantName: prefs.name,
        onStatus: (next) => {
          logWakeDiagnostic('prisma_status_transition', { status: next });
          setStatus(next);
          if (next === 'detected' || next === 'processing') {
            setErrorMessageKey('');
          }
          if ((next === 'permission' || next === 'error' || next === 'unsupported') && controller.current && !controller.current.isActive) {
            controller.current = null;
          }
        },
        onError: (error) => {
          const errorKeys = {
            permission: 'handsFreeErrorPermission',
            no_microphone: 'handsFreeErrorNoMicrophone',
            network: 'handsFreeErrorNetwork',
            timeout: 'handsFreeErrorTimeout',
            service: 'handsFreeErrorService',
            empty_transcript: 'handsFreeErrorEmptyTranscript',
            unsupported_audio: 'handsFreeErrorUnsupportedAudio',
            recording: 'handsFreeErrorRecording',
          } as const;
          setErrorMessageKey(errorKeys[error]);
        },
        onQuestion: (question, onSpeakingEnd, onSpeakingError, onSpeakingStart) => {
          logWakeDiagnostic('forward_question_to_assistant', { question });
          openAssistant();
          void sendMessage(question, undefined, {
            onSpeakingStart: () => {
              logWakeDiagnostic('assistant_speech_start');
              onSpeakingStart?.();
            },
            onSpeakingEnd: () => {
              logWakeDiagnostic('assistant_speech_end');
              onSpeakingEnd?.();
            },
            onSpeakingError: () => {
              logWakeDiagnostic('assistant_speech_error');
              onSpeakingError?.();
            },
          });
        },
      });
      controller.current = prismaInstance;
      void prismaInstance.start();
      return;
    }

    // Otherwise (English OR Indic languages when Prisma live calls are not authorized):
    // Use genuine browser speech recognition for the selected language
    // 1. Check on-device recognition
    const onDevice = await checkOnDeviceRecognition(language);
    logWakeDiagnostic('check_on_device_result', { language, supported: onDevice.supported });
    if (onDevice.supported && onDevice.Constructor) {
      setEngineMode('on_device');
      setShowConsent(false);
      startListening(onDevice.Constructor, 'on_device');
      return;
    }

    // 2. Check standard browser recognition fallback (browser engine fallback)
    const browser = checkBrowserRecognition(language);
    logWakeDiagnostic('check_browser_result', { language, supported: browser.supported });
    if (browser.supported && browser.Constructor) {
      setEngineMode('browser_cloud');
      localStorage.setItem('kisan_hita_wake_consent', 'true');
      setShowConsent(false);
      startListening(browser.Constructor, 'browser_cloud');
      return;
    }

    // 3. Browser recognition unsupported for this language & Prisma is unavailable
    setEngineMode(null);
    setStatus('unsupported');
    setErrorMessageKey('handsFreeErrorUnsupported');
    logWakeDiagnostic('recognition_unsupported', { language });
    return;
  };

  const handleConsentAndStart = async () => {
    logWakeDiagnostic('user_clicked_consent_and_start');
    localStorage.setItem('kisan_hita_wake_consent', 'true');
    const mic = await requestMicrophoneAccess();
    if (!mic.granted) {
      setStatus('permission');
      return;
    }
    const browser = checkBrowserRecognition(language);
    if (!browser.supported || !browser.Constructor) {
      setStatus('unsupported');
      setShowConsent(false);
      return;
    }
    setShowConsent(false);
    setEngineMode('browser_cloud');
    startListening(browser.Constructor, 'browser_cloud');
  };

  const stop = () => {
    logWakeDiagnostic('user_stopped_hands_free');
    if (isSpeaking) {
      stopSpeaking();
    }
    controller.current?.stop();
    controller.current = null;
    setStatus('disabled');
    setErrorMessageKey('');
    setShowConsent(false);
  };

  const active = Boolean(controller.current?.isActive);

  return (
    <aside className="hands-free-widget" aria-label={t('handsFreeTitle')}>
      <details
        open={isExpanded}
        onToggle={(e) => {
          setIsExpanded(e.currentTarget.open);
        }}
      >
        <summary>
          <Mic size={16} />
          <span>{t('handsFreeTitle')}</span>
          {active && <span className="active-dot" aria-label="Listening active" />}
        </summary>
        <div
          className="hands-free-panel"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <button
            type="button"
            className="hands-free-close-btn"
            onClick={() => setIsExpanded(false)}
            aria-label="Close"
            title="Close"
          >
            <X size={15} />
          </button>
          {engineMode && (
            <div className={`hands-free-mode-badge ${engineMode}`}>
              <span className="mode-indicator" />
              <span>{t(engineMode === 'on_device' ? 'handsFreeModeOnDevice' : (engineMode === 'prisma_multilingual' ? 'handsFreeModePrisma' : 'handsFreeModeBrowser'))}</span>
            </div>
          )}

          {showConsent ? (
            <div className="hands-free-consent-card" role="region" aria-label="Recognition consent">
              <div className="hands-free-consent-header">
                <ShieldAlert size={16} className="consent-alert-icon" />
                <strong>{t('handsFreeModeBrowser')}</strong>
              </div>
              <p className="hands-free-consent-text">{t('handsFreeConsentNotice')}</p>
              <p className="hands-free-foreground-text">{t('handsFreeForegroundNotice')}</p>
              <div className="hands-free-consent-actions">
                <button type="button" className="btn-consent-start" onClick={handleConsentAndStart}>
                  <Check size={14} />
                  {t('handsFreeConsentButton')}
                </button>
                <button
                  type="button"
                  className="btn-text-fallback"
                  onClick={() => {
                    setShowConsent(false);
                    openAssistant();
                  }}
                >
                  <MessageSquare size={14} />
                  {t('handsFreeUseTextFallback')}
                </button>
                <button
                  type="button"
                  className="btn-consent-skip"
                  onClick={() => {
                    setShowConsent(false);
                    setStatus('disabled');
                  }}
                >
                  {t('handsFreeSkip')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p>{t('handsFreeDescription')}</p>
              <p><strong>{t('handsFreePhrase')}:</strong> {assistantName}</p>
              <p role="status" aria-live="polite" className="hands-free-status-text">{t(STATUS_KEY[status])}</p>
              {errorMessageKey && <p role="alert" className="hands-free-error-text">{t(errorMessageKey)}</p>}
              {status === 'unsupported' && (
                <div role="alert" style={{
                  margin: '0.6rem 0',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '0.5rem',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  color: '#fca5a5',
                  fontSize: '0.78rem',
                  lineHeight: 1.45,
                }}>
                  <strong>{BROWSER_LIMITATION_TITLE[language] || BROWSER_LIMITATION_TITLE.en}</strong>
                  <p style={{ margin: '0.25rem 0 0', color: 'var(--cream)' }}>{t('handsFreeUnsupported')}</p>
                </div>
              )}
              <p className="hands-free-privacy">{t('handsFreePrivacy')}</p>
              <p className="hands-free-foreground">{t('handsFreeForegroundNotice')}</p>
              <div className="hands-free-controls">
                {!active ? (
                  <button type="button" onClick={() => void start()}>
                    <Mic size={16} />
                    {status === 'unsupported' || status === 'error' ? t('handsFreeRetry') : t('handsFreeEnable')}
                  </button>
                ) : (
                  <button type="button" onClick={stop}>
                    <MicOff size={16} />
                    {t('handsFreeStop')}
                  </button>
                )}
                <button
                  type="button"
                  className="hands-free-fallback-btn"
                  onClick={() => openAssistant()}
                  title={t('handsFreeUseTextFallback')}
                >
                  <MessageSquare size={14} />
                  {t('handsFreeUseTextFallback')}
                </button>
                <button
                  type="button"
                  className="hands-free-settings"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('kisan-hita:open-settings'));
                  }}
                >
                  <Settings2 size={15} />
                  {t('handsFreeOptional')}
                </button>
              </div>
            </>
          )}
        </div>
      </details>
      <style>{`
        .hands-free-widget { position: fixed; z-index: 41; right: 1rem; bottom: 5.7rem; color: var(--cream); font-size: .84rem; }
        .hands-free-widget summary { display: flex; align-items: center; gap: .4rem; list-style: none; cursor: pointer; padding: .65rem .85rem; border: 1px solid var(--border-card); border-radius: 999px; background: rgba(28,30,20,.96); box-shadow: 0 8px 25px rgba(0,0,0,.3); }
        .hands-free-widget .active-dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; animation: pulse-dot 1.5s infinite; }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .4; transform: scale(1.2); } }
        .hands-free-panel { position: absolute; right: 0; bottom: 2.7rem; width: min(340px, calc(100vw - 2rem)); padding: 1rem; border: 1px solid var(--border-subtle); border-radius: 1rem; background: var(--char-card); box-shadow: 0 15px 40px rgba(0,0,0,.55); }
        .hands-free-panel p { line-height: 1.5; margin: .3rem 0; }
        .hands-free-close-btn { position: absolute; top: .65rem; right: .65rem; background: transparent !important; border: none !important; color: var(--text-muted); padding: .25rem !important; cursor: pointer; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; }
        .hands-free-close-btn:hover { color: var(--cream); }
        .hands-free-mode-badge { display: inline-flex; align-items: center; gap: .35rem; font-size: .72rem; padding: .2rem .55rem; border-radius: 999px; margin-bottom: .45rem; }
        .hands-free-mode-badge.on_device { background: rgba(74, 222, 128, .12); color: #86efac; border: 1px solid rgba(74, 222, 128, .3); }
        .hands-free-mode-badge.prisma_multilingual { background: rgba(56, 189, 248, .12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, .3); }
        .hands-free-mode-badge.browser_cloud { background: rgba(240, 168, 58, .12); color: #fcd34d; border: 1px solid rgba(240, 168, 58, .3); }
        .hands-free-mode-badge .mode-indicator { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
        .hands-free-consent-card { border: 1px solid rgba(240, 168, 58, .3); background: rgba(28, 30, 20, .85); border-radius: .75rem; padding: .75rem; margin-top: .3rem; }
        .hands-free-consent-header { display: flex; align-items: center; gap: .4rem; font-size: .82rem; color: #fcd34d; margin-bottom: .3rem; }
        .hands-free-consent-text { font-size: .77rem; color: var(--cream); line-height: 1.4; }
        .hands-free-foreground-text, .hands-free-foreground { font-size: .74rem; color: var(--text-muted); font-style: italic; }
        .hands-free-consent-actions { display: flex; flex-direction: column; gap: .35rem; margin-top: .6rem; }
        .hands-free-panel button { display: inline-flex; align-items: center; justify-content: center; gap: .45rem; padding: .5rem .75rem; border: 1px solid var(--border-card); border-radius: 999px; color: var(--cream); background: rgba(240,168,58,.1); cursor: pointer; font-size: .78rem; }
        .hands-free-panel button:hover { background: rgba(240,168,58,.2); }
        .hands-free-controls { display: flex; flex-wrap: wrap; gap: .3rem; margin-top: .5rem; }
        .btn-consent-start { background: rgba(74, 222, 128, .15) !important; color: #86efac !important; border-color: rgba(74, 222, 128, .4) !important; font-weight: 600; }
        .btn-text-fallback { background: rgba(255, 255, 255, .05) !important; }
        .btn-consent-skip { background: transparent !important; border-color: transparent !important; color: var(--text-muted) !important; font-size: .72rem !important; }
        .hands-free-panel .hands-free-privacy { font-size: .74rem; color: var(--text-muted); }
        .hands-free-status-text { font-weight: 500; color: #fcd34d; }
        .hands-free-error-text { color: #fca5a5; }
        @media(max-width:600px){ .hands-free-widget { right: .6rem; bottom: 5.3rem; } .hands-free-widget summary { font-size: .75rem; } }
      `}</style>
    </aside>
  );
};
