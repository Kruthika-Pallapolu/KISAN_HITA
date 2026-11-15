import type { SupportedLanguage } from '../i18n/translations';
import { getPrismaRecordingExtension, selectPrismaRecordingMime } from './prismaRecording.ts';

export const SPEECH_LOCALES: Record<SupportedLanguage, string> = {
  en:'en-IN', te:'te-IN', hi:'hi-IN', ta:'ta-IN', kn:'kn-IN', ml:'ml-IN', mr:'mr-IN',
};
export type WakeStatus = 'disabled'|'suspended'|'permission'|'listening'|'question'|'processing'|'speaking'|'reconnecting'|'unsupported'|'error'|'detected'|'waiting_for_answer';
export type RecognitionEngineMode = 'on_device' | 'browser_cloud' | 'prisma_multilingual';
type RecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean; processLocally?: boolean;
  onstart: null | (() => void); onresult: null | ((event: any) => void); onerror: null | ((event: any) => void); onend: null | (() => void);
  start(): void; stop(): void; abort?(): void;
};
type RecognitionCtor = new () => RecognitionLike;
type SpeechWindow = Window & { SpeechRecognition?: RecognitionCtor & { available?: (options: any) => Promise<string> }; webkitSpeechRecognition?: RecognitionCtor & { available?: (options: any) => Promise<string> } };
type WakeOptions = {
  language: SupportedLanguage;
  phrase: string;
  assistantName?: string;
  Constructor: RecognitionCtor;
  mode?: RecognitionEngineMode;
  onStatus: (status: WakeStatus) => void;
  onQuestion: (
    text: string,
    onSpeakingEnd?: () => void,
    onSpeakingError?: () => void,
    onSpeakingStart?: () => void
  ) => void;
};

export async function checkOnDeviceRecognition(language: SupportedLanguage, target?: SpeechWindow): Promise<{ supported: boolean; Constructor?: RecognitionCtor }> {
  const browser = target || (typeof window !== 'undefined' ? window as SpeechWindow : undefined);
  if (!browser) return { supported: false };
  const Constructor = browser.SpeechRecognition || browser.webkitSpeechRecognition;
  if (!Constructor || typeof Constructor.available !== 'function') return { supported: false };
  try {
    const availability = await Constructor.available({ langs: [SPEECH_LOCALES[language]], processLocally: true });
    if (availability !== 'available') return { supported: false };
    const instance = new Constructor();
    if (!('processLocally' in instance)) return { supported: false };
    return { supported: true, Constructor };
  } catch { return { supported: false }; }
}

export function checkBrowserRecognition(language: SupportedLanguage, target?: SpeechWindow): { supported: boolean; Constructor?: RecognitionCtor } {
  const browser = target || (typeof window !== 'undefined' ? window as SpeechWindow : undefined);
  if (!browser) return { supported: false };
  const Constructor = browser.SpeechRecognition || browser.webkitSpeechRecognition;
  if (!Constructor) return { supported: false };
  if (!SPEECH_LOCALES[language]) return { supported: false };
  return { supported: true, Constructor };
}

export type RecognitionCapability = {
  supported: boolean;
  mode: RecognitionEngineMode | 'unsupported';
  Constructor?: RecognitionCtor;
};

export async function detectRecognitionEngine(language: SupportedLanguage, target?: SpeechWindow): Promise<RecognitionCapability> {
  const onDevice = await checkOnDeviceRecognition(language, target);
  if (onDevice.supported && onDevice.Constructor) {
    return { supported: true, mode: 'on_device', Constructor: onDevice.Constructor };
  }
  const browser = checkBrowserRecognition(language, target);
  if (browser.supported && browser.Constructor) {
    return { supported: true, mode: 'browser_cloud', Constructor: browser.Constructor };
  }
  return { supported: false, mode: 'unsupported' };
}

export function logWakeDiagnostic(event: string, details?: Record<string, any>) {
  if (typeof console !== 'undefined' && console.log) {
    console.log(`[HandsFree:${event}]`, details ? JSON.stringify(details) : '');
  }
}

export async function requestMicrophoneAccess(): Promise<{ granted: boolean; error?: string }> {
  logWakeDiagnostic('request_mic_permission_start');
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    logWakeDiagnostic('request_mic_unsupported');
    return { granted: false, error: 'unsupported' };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    logWakeDiagnostic('request_mic_permission_granted', { trackCount: stream.getTracks().length });
    stream.getTracks().forEach((track) => track.stop());
    return { granted: true };
  } catch (err: any) {
    const name = err?.name || '';
    logWakeDiagnostic('request_mic_permission_denied', { error: name, message: err?.message });
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return { granted: false, error: 'permission_denied' };
    }
    return { granted: false, error: name || 'error' };
  }
}

export const SPEECH_PAUSE_MS = 2000;
export const FOLLOW_UP_WINDOW_MS = 10_000;
export const STT_REQUEST_TIMEOUT_MS = 35_000;
export const DEFAULT_ASSISTANT_NAME = 'Mitra';

const COMMON_NAME_VARIANTS: Record<string, string[]> = {
  apple: [
    'apple', 'appl', 'eppal', 'epal',
    'एप्पल', 'ऐप्पल', 'एपल', 'ऐपल', 'एपिल',
    'ఆపిల్', 'యాపిల్', 'ఆపిల్‌',
    'ஆப்பிள்', 'ஆபில்',
    'ಆಪಲ್', 'ಆಪಲ್‌', 'ಆಪಿಲ್',
    'ആപ്പിൾ', 'ആപിൽ',
    'ॲपल',
  ],
  oreo: ['oreo', 'ori', 'orie', 'oryo', 'ఓరియో', 'ఒరియో', 'ओरियो', 'ओरिओ', 'ஓரியோ', 'ಓರಿಯೋ', 'ഓറിയോ', 'ओरेओ'],
  keshav: ['keshav', 'keshu', 'kesh', 'kashav', 'కేశవ్', 'కేశవ', 'కేశు', 'केशव', 'केशु', 'கேசவ்', 'ಕೇಶವ್', 'ಕೇಶು', 'കേശവ്'],
  lakshmi: ['lakshmi', 'laxmi', 'lakshu', 'lucky', 'లక్ష్మి', 'లక్ష్మీ', 'లక్షు', 'लक्ष्मी', 'लक्षी', 'லட்சுமி', 'ಲಕ್ಷ್ಮಿ', 'లಕ್ಷ್ಮಿ'],
  mitra: ['mitra', 'mitr', 'mitroo', 'మిత్రా', 'మిత్ర', 'मित्र', 'मित्रा', 'மித்ரா', 'ಮಿತ್ರ', 'മിത്രാ'],
  kisan: ['kisan', 'kisaan', 'किसान', 'కిసాన్', 'கிசான்', 'ಕಿಸಾನ್', 'കിസാൻ'],
  ramu: ['ramu', 'ram', 'raam', 'रामू', 'राम', 'రాము', 'రామ్', 'ராமு', 'ರಾಮು', 'രാമു'],
  sakhi: ['sakhi', 'सखी', 'సఖి', 'சகி', 'ಸಖಿ', 'സഖി'],
};

COMMON_NAME_VARIANTS.lakshmi.push('ലക്ഷ്മി');

export function indicToPhonetic(text: string): string {
  const map: Record<string, string> = {
    'ए': 'e', 'ऐ': 'ai', 'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ओ': 'o', 'औ': 'au',
    'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
    'क': 'k', 'ख': 'k', 'ग': 'g', 'घ': 'g', 'च': 'ch', 'छ': 'ch', 'ज': 'j', 'झ': 'j',
    'ट': 't', 'ठ': 't', 'ड': 'd', 'ढ': 'd', 'ण': 'n', 'त': 't', 'थ': 't', 'द': 'd', 'ध': 'd', 'न': 'n',
    'प': 'p', 'फ': 'p', 'ब': 'b', 'भ': 'b', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
    'श': 's', 'ष': 's', 'स': 's', 'ह': 'h', '्': '',
    'అ': 'a', 'ఆ': 'a', 'ఇ': 'i', 'ఈ': 'i', 'ఉ': 'u', 'ఊ': 'u', 'ఎ': 'e', 'ఏ': 'e', 'ఐ': 'ai', 'ఒ': 'o', 'ఓ': 'o', 'ఔ': 'au',
    'ా': 'a', 'ి': 'i', 'ీ': 'i', 'ు': 'u', 'ూ': 'u', 'ె': 'e', 'ే': 'e', 'ై': 'ai', 'ొ': 'o', 'ో': 'o', 'ౌ': 'au',
    'క': 'k', 'ఖ': 'k', 'గ': 'g', 'ఘ': 'g', 'చ': 'ch', 'ఛ': 'ch', 'జ': 'j', 'ఝ': 'j',
    'ట': 't', 'ఠ': 't', 'డ': 'd', 'ఢ': 'd', 'ణ': 'n', 'త': 't', 'థ': 't', 'ద': 'd', 'ధ': 'd', 'న': 'n',
    'ప': 'p', 'ఫ': 'p', 'బ': 'b', 'భ': 'b', 'మ': 'm', 'య': 'y', 'ర': 'r', 'ల': 'l', 'వ': 'v',
    'శ': 's', 'ష': 's', 'స': 's', 'హ': 'h', '్': '',
  };
  let out = '';
  for (const ch of text) {
    out += map[ch] !== undefined ? map[ch] : ch;
  }
  return out.toLowerCase().replace(/(.)\1+/g, '$1');
}

export function getAssistantNameVariants(name: string): string[] {
  const norm = name.normalize('NFKC').trim().toLowerCase();
  if (!norm) return [];

  const variants = new Set<string>();
  variants.add(norm);

  // Direct lookup or reverse lookup across all multilingual variants
  for (const [key, list] of Object.entries(COMMON_NAME_VARIANTS)) {
    if (key === norm || list.some((item) => item.toLowerCase() === norm)) {
      variants.add(key);
      for (const v of list) {
        variants.add(v.toLowerCase());
      }
    }
  }

  // Support natural short-name variants for Indian names
  if (norm.endsWith('av') && norm.length > 3) {
    variants.add(`${norm.slice(0, -2)}u`);
    variants.add(`${norm.slice(0, -2)}`);
  }
  if (norm.endsWith('mi') && norm.length > 3) {
    variants.add(`${norm.slice(0, -2)}u`);
  }
  if (norm.endsWith('esh') && norm.length > 4) {
    variants.add(`${norm.slice(0, -3)}i`);
    variants.add(`${norm.slice(0, -3)}u`);
  }
  if (norm.endsWith('endra') && norm.length > 5) {
    variants.add(`${norm.slice(0, -5)}u`);
  }

  return Array.from(variants);
}

export function removeWakePhrase(
  transcript: string,
  phrase: string,
  assistantName?: string
): { detected: boolean; question: string } {
  const normalize = (value: string) =>
    value.normalize('NFKC').toLocaleLowerCase().replace(/[.,!?;:।]/g, ' ').replace(/\s+/g, ' ').trim();

  const normTranscript = normalize(transcript);
  if (!normTranscript) return { detected: false, question: '' };

  const normPhrase = normalize(phrase);
  const rawTokens = transcript.trim().match(/\S+/g) || [];
  const normTokens = normTranscript.match(/\S+/g) || [];

  // 1. Direct match with configured wake phrase
  const phraseTokens = normPhrase.match(/\S+/g) || [];
  const phraseTokenCount = phraseTokens.length;
  if (phraseTokenCount > 0 && normTokens.length >= phraseTokenCount) {
    const candidate = normTokens.slice(0, phraseTokenCount).join(' ');
    if (candidate === normPhrase) {
      const question = rawTokens.slice(phraseTokenCount).join(' ').replace(/^[\s,.:;!?-]+/, '').trim();
      return { detected: true, question };
    }
  }

  // 2. Direct match with assistant name, short-name variants, and greeting prefixes
  const activeName = assistantName?.trim() || phrase.replace(/^(hey|hello|hi|namaste|ok|okay|హే|నమస్తే|హలో|విను|हे|नमस्ते|सुनो|हेलो|हाय|ओके|ஹே|வணக்கம்|ಹೇ|ನಮಸ್ಕಾರ|ഹേ|നമസ്കാരം)\s+/i, '').trim() || DEFAULT_ASSISTANT_NAME;
  const variants = getAssistantNameVariants(activeName);

  const greetings = [
    'hey', 'hello', 'hi', 'ok', 'okay', 'dear', 'namaste', 'suno', 'alo',
    'హే', 'నమస్తే', 'హలో', 'విను', 'బాగున్నారా',
    'हे', 'नमस्ते', 'सुनो', 'हेलो', 'हाय', 'ओके',
    'ஹே', 'வணக்கம்', 'சொல்லு',
    'ಹೇ', 'ನಮಸ್ಕಾರ', 'ಕೇಳು',
    'ഹേ', 'നമസ്കാരം'
  ];

  for (const variant of variants) {
    const normVariant = normalize(variant);
    if (!normVariant) continue;

    const variantTokens = normVariant.match(/\S+/g) || [];
    const variantTokenCount = variantTokens.length;

    // Direct name at start of utterance: "Apple, what is the weather?" or "एप्पल आज मौसम कैसा है?"
    if (normTokens.length >= variantTokenCount) {
      const candidate = normTokens.slice(0, variantTokenCount).join(' ');
      if (candidate === normVariant) {
        const question = rawTokens.slice(variantTokenCount).join(' ').replace(/^[\s,.:;!?-]+/, '').trim();
        return { detected: true, question };
      }
    }

    // Greeting + Name: "Hey Apple", "Hello Apple", "हे एप्पल", "హే ఆపిల్", "नमस्ते एप्पल"
    if (normTokens.length >= variantTokenCount + 1 && normTokens[0] && greetings.includes(normTokens[0])) {
      const candidate = normTokens.slice(1, variantTokenCount + 1).join(' ');
      if (candidate === normVariant) {
        const question = rawTokens.slice(variantTokenCount + 1).join(' ').replace(/^[\s,.:;!?-]+/, '').trim();
        return { detected: true, question };
      }
    }
  }

  // 3. General phonetic fallback matching for arbitrary custom names across scripts
  const phoneticName = indicToPhonetic(activeName);
  if (phoneticName.length >= 3) {
    const firstToken = normTokens[0];
    if (firstToken) {
      const tokenPhonetic = indicToPhonetic(firstToken);
      if (tokenPhonetic === phoneticName || (tokenPhonetic.length >= 4 && phoneticName.startsWith(tokenPhonetic))) {
        const question = rawTokens.slice(1).join(' ').replace(/^[\s,.:;!?-]+/, '').trim();
        return { detected: true, question };
      }
    }
    const secondToken = normTokens[1];
    if (firstToken && secondToken && greetings.includes(firstToken)) {
      const tokenPhonetic = indicToPhonetic(secondToken);
      if (tokenPhonetic === phoneticName || (tokenPhonetic.length >= 4 && phoneticName.startsWith(tokenPhonetic))) {
        const question = rawTokens.slice(2).join(' ').replace(/^[\s,.:;!?-]+/, '').trim();
        return { detected: true, question };
      }
    }
  }

  return { detected: false, question: '' };
}

/** Foreground-only recognition manager. Each restart waits for `onend`, so two
 * microphones are never active together. All recognition is forced local. */
export class LocalWakeController {
  private active = false;
  private mode: 'wake' | 'question' = 'wake';
  private recognition: RecognitionLike | null = null;
  private attempts = 0;
  private submitted = false;
  private finals = new Set<number>();
  private transcript = '';
  private interimTranscript = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private speechPauseTimer: ReturnType<typeof setTimeout> | undefined;
  private silenceCycles = 0;
  private options: WakeOptions;

  private sessionCounter = 0;
  private currentSessionId = 0;
  private sessionStartTime = 0;
  private speechDetectedInSession = false;
  private lastSessionError: string | null = null;
  private stoppingReason: string | null = null;

  // Exact speech pause and debounce tracking
  private lastSpeechText = '';
  private lastSpeechTime = 0;
  private pendingQuestionText = '';

  constructor(options: WakeOptions) {
    this.options = options;
  }

  get isActive() {
    return this.active;
  }

  start() {
    this.active = true;
    this.mode = 'wake';
    this.attempts = 0;
    this.lastSessionError = null;
    this.stoppingReason = null;
    this.submitted = false;
    this.silenceCycles = 0;
    this.lastSpeechText = '';
    this.lastSpeechTime = 0;
    this.pendingQuestionText = '';
    this.startRecognition();
  }

  stop() {
    this.active = false;
    this.submitted = false;
    this.currentSessionId = ++this.sessionCounter;
    this.clearTimer();
    this.pendingQuestionText = '';
    this.lastSpeechText = '';
    this.stopCurrentRecognition('user_stopped');
    this.options.onStatus('disabled');
  }

  resume() {
    if (!this.active) return;
    this.handleSpeakingEnd();
  }

  updatePreferences(name: string, phrase?: string) {
    this.options.assistantName = name;
    if (phrase) this.options.phrase = phrase;
    logWakeDiagnostic('preferences_updated_live', { name, phrase: this.options.phrase });
  }

  updateLanguage(language: SupportedLanguage) {
    if (this.options.language === language) return;
    const oldLang = this.options.language;
    this.options.language = language;
    this.attempts = 0;
    this.lastSessionError = null;
    this.lastSpeechText = '';
    this.lastSpeechTime = 0;
    this.pendingQuestionText = '';
    logWakeDiagnostic('language_updated_live', {
      from: oldLang,
      to: language,
      locale: SPEECH_LOCALES[language],
    });
    if (this.active) {
      this.currentSessionId = ++this.sessionCounter;
      this.stopCurrentRecognition('language_change');
      this.scheduleStart(150);
    }
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.speechPauseTimer) {
      clearTimeout(this.speechPauseTimer);
      this.speechPauseTimer = undefined;
    }
  }

  private stopCurrentRecognition(reason: string = 'internal') {
    this.clearTimer();
    const current = this.recognition;
    this.recognition = null;
    this.stoppingReason = reason;
    if (current) {
      logWakeDiagnostic('stopping_current_recognition', { reason, sessionId: this.currentSessionId });
      try {
        current.abort?.();
      } catch {
        try {
          current.stop();
        } catch {}
      }
    }
  }

  private scheduleStart(delay: number) {
    this.clearTimer();
    if (!this.active) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.startRecognition();
    }, delay);
  }

  private startRecognition() {
    if (!this.active || this.submitted) return;
    if (this.recognition) {
      logWakeDiagnostic('startRecognition_skipped_already_running', {
        sessionId: this.currentSessionId,
      });
      return;
    }

    const sessionId = ++this.sessionCounter;
    this.currentSessionId = sessionId;
    this.sessionStartTime = Date.now();
    this.speechDetectedInSession = false;
    this.lastSessionError = null;
    this.stoppingReason = null;
    this.finals.clear();
    this.transcript = '';
    this.interimTranscript = '';

    const recognizer = new this.options.Constructor();
    this.recognition = recognizer;

    const locale = SPEECH_LOCALES[this.options.language] || 'en-IN';
    recognizer.lang = locale;
    recognizer.continuous = true;
    recognizer.interimResults = true;

    if (this.options.mode !== 'browser_cloud') {
      recognizer.processLocally = true;
    }

    logWakeDiagnostic('recognizer_instance_created', {
      sessionId,
      language: this.options.language,
      locale,
      mode: this.mode,
    });

    recognizer.onstart = () => {
      if (sessionId !== this.currentSessionId || !this.active || this.recognition !== recognizer) {
        logWakeDiagnostic('stale_session_onstart_ignored', { sessionId, currentSessionId: this.currentSessionId });
        return;
      }
      logWakeDiagnostic('session_start', {
        sessionId,
        mode: this.mode,
        locale,
        startTime: this.sessionStartTime,
      });
      this.attempts = 0;
      this.options.onStatus(this.mode === 'wake' ? 'listening' : 'question');
    };

    (recognizer as any).onspeechend = () => {
      if (sessionId !== this.currentSessionId || !this.active || this.recognition !== recognizer) return;
      logWakeDiagnostic('recognition_onspeechend', {
        sessionId,
        lastSpeechText: this.lastSpeechText,
        elapsedSinceSpeech: Date.now() - this.lastSpeechTime,
      });
    };

    recognizer.onresult = (event) => {
      if (sessionId !== this.currentSessionId || !this.active || this.recognition !== recognizer) {
        logWakeDiagnostic('stale_session_onresult_ignored', { sessionId, currentSessionId: this.currentSessionId });
        return;
      }

      let interim = '';
      let newFinalAdded = false;
      for (let i = Number(event.resultIndex || 0); i < event.results.length; i += 1) {
        const item = event.results[i];
        if (item?.isFinal) {
          if (!this.finals.has(i)) {
            this.finals.add(i);
            this.attempts = 0;
            this.silenceCycles = 0;
            const text = item[0]?.transcript || '';
            this.transcript += `${this.transcript ? ' ' : ''}${text}`;
            newFinalAdded = true;
            logWakeDiagnostic('recognition_result_final', { sessionId, chunk: text, fullTranscript: this.transcript });
          }
        } else {
          interim += `${interim ? ' ' : ''}${item[0]?.transcript || ''}`;
        }
      }
      this.interimTranscript = interim;
      if (interim) {
        logWakeDiagnostic('recognition_result_interim', { sessionId, interim });
      }

      const fullCurrentText = (this.transcript + (this.interimTranscript ? ' ' + this.interimTranscript : '')).trim();
      if (!fullCurrentText) return;

      const isNewSpeech = newFinalAdded || (fullCurrentText !== this.lastSpeechText);

      if (isNewSpeech) {
        const isFirstSpeech = !this.speechDetectedInSession;
        this.speechDetectedInSession = true;
        this.lastSpeechText = fullCurrentText;
        this.lastSpeechTime = Date.now();

        if (isFirstSpeech) {
          logWakeDiagnostic('first_speech_detected', {
            sessionId,
            locale,
            text: fullCurrentText,
            time: this.lastSpeechTime,
          });
        }

        if (this.mode === 'wake') {
          const match = removeWakePhrase(fullCurrentText, this.options.phrase, this.options.assistantName);
          if (match.detected) {
            logWakeDiagnostic('wake_detected_transition_to_question', {
              sessionId,
              name: this.options.assistantName,
              phrase: this.options.phrase,
              detectedQuestion: match.question,
            });
            this.mode = 'question';
            this.options.onStatus('question');
          }
        }

        if (this.mode === 'question') {
          const match = removeWakePhrase(fullCurrentText, this.options.phrase, this.options.assistantName);
          const q = (match.detected ? match.question : fullCurrentText).trim();
          if (q) {
            this.pendingQuestionText = q;
            // Genuinely new speech captured! Reset the exact 2,000ms silence timer.
            if (this.speechPauseTimer) {
              clearTimeout(this.speechPauseTimer);
            }
            logWakeDiagnostic('speech_timer_started_2000ms', { sessionId, question: q, speechTime: this.lastSpeechTime });
            this.speechPauseTimer = setTimeout(() => {
              this.onSpeechSilenceCompleted(sessionId);
            }, SPEECH_PAUSE_MS);
          } else {
            // Wake name only, waiting for question
            this.pendingQuestionText = '';
            if (this.speechPauseTimer) {
              clearTimeout(this.speechPauseTimer);
              this.speechPauseTimer = undefined;
            }
            logWakeDiagnostic('wake_name_only_waiting_for_user_question', { sessionId, fullCurrentText });
          }
        }
      } else {
        // Duplicate or unchanged interim transcript from Safari - do not reset timer
        logWakeDiagnostic('duplicate_interim_ignored', { sessionId, fullCurrentText });
      }
    };

    recognizer.onerror = (event) => {
      if (sessionId !== this.currentSessionId || !this.active) {
        logWakeDiagnostic('stale_session_onerror_ignored', { sessionId, currentSessionId: this.currentSessionId });
        return;
      }
      const error = String(event?.error || 'unknown');
      this.lastSessionError = error;
      logWakeDiagnostic('recognition_onerror', {
        sessionId,
        error,
        language: this.options.language,
        locale,
      });

      if (error === 'not-allowed') {
        this.active = false;
        this.stopCurrentRecognition('permission_denied');
        this.options.onStatus('permission');
        return;
      }

      if (error === 'service-not-allowed' || error === 'language-not-supported' || error === 'bad-grammar') {
        logWakeDiagnostic('service_or_locale_unsupported_permanent_stop', { error, locale, language: this.options.language });
        this.active = false;
        this.stopCurrentRecognition(error === 'service-not-allowed' ? 'service_not_allowed' : 'language_not_supported');
        this.options.onStatus('unsupported');
        return;
      }

      if (error === 'no-speech') {
        return;
      }

      if (error === 'aborted') {
        return;
      }

      // Transient errors (network, audio-capture, etc.)
      this.attempts += 1;
      if (this.attempts >= 4) {
        logWakeDiagnostic('max_attempts_reached_error', { attempts: this.attempts, error });
        this.options.onStatus('reconnecting');
      } else {
        logWakeDiagnostic('retry_reconnecting', { attempt: this.attempts, error });
        this.options.onStatus('reconnecting');
      }
    };

    recognizer.onend = () => {
      if (this.recognition === recognizer) {
        this.recognition = null;
      }
      if (sessionId !== this.currentSessionId) {
        logWakeDiagnostic('stale_session_onend_ignored', { sessionId, currentSessionId: this.currentSessionId });
        return;
      }
      if (!this.active || this.submitted) return;

      const sessionDuration = Date.now() - this.sessionStartTime;
      const rawText = (this.transcript + (this.interimTranscript ? ' ' + this.interimTranscript : '')).trim() || this.lastSpeechText;

      logWakeDiagnostic('recognition_onend', {
        sessionId,
        mode: this.mode,
        duration: sessionDuration,
        transcript: rawText,
        lastError: this.lastSessionError,
        stoppingReason: this.stoppingReason || 'engine_end',
        controllerActiveAfterEnd: this.active,
      });

      if (this.mode === 'wake') {
        const match = removeWakePhrase(rawText, this.options.phrase, this.options.assistantName);
        logWakeDiagnostic('wake_match_check', {
          sessionId,
          transcript: rawText,
          phrase: this.options.phrase,
          name: this.options.assistantName,
          detected: match.detected,
          question: match.question,
        });

        if (match.detected) {
          this.options.onStatus('detected');
          if (match.question) {
            if (this.speechPauseTimer) {
              clearTimeout(this.speechPauseTimer);
              this.speechPauseTimer = undefined;
            }
            this.submit(match.question);
          } else {
            this.mode = 'question';
            this.options.onStatus('question');
            logWakeDiagnostic('restart_decision', { sessionId, locale, reason: 'wake_detected_restart_question_mode', delay: 80 });
            this.scheduleStart(80);
          }
          return;
        }

        // Normal silence / short wake session: continue listening seamlessly
        const delay = this.attempts > 0 ? Math.min(2000, this.attempts * 500) : 80;
        logWakeDiagnostic('restart_decision', { sessionId, locale, reason: 'wake_silence_restart', delay });
        this.transcript = '';
        this.interimTranscript = '';
        this.lastSpeechText = '';
        this.scheduleStart(delay);
        return;
      }

      // mode === 'question'
      let answerText = rawText;
      if (answerText) {
        const match = removeWakePhrase(answerText, this.options.phrase, this.options.assistantName);
        if (match.detected) {
          if (match.question) {
            answerText = match.question;
            if (this.speechPauseTimer) {
              clearTimeout(this.speechPauseTimer);
              this.speechPauseTimer = undefined;
            }
            logWakeDiagnostic('question_answer_captured', { answer: answerText });
            this.submit(answerText);
            return;
          } else {
            this.mode = 'question';
            this.options.onStatus('question');
            logWakeDiagnostic('restart_decision', { sessionId, locale, reason: 'wake_name_only_question_restart', delay: 80 });
            this.scheduleStart(80);
            return;
          }
        } else {
          if (this.speechPauseTimer) {
            clearTimeout(this.speechPauseTimer);
            this.speechPauseTimer = undefined;
          }
          logWakeDiagnostic('question_answer_captured', { answer: answerText });
          this.submit(answerText);
          return;
        }
      } else {
        this.silenceCycles += 1;
        logWakeDiagnostic('question_silence', { sessionId, cycle: this.silenceCycles });
        if (this.silenceCycles < 6) {
          this.options.onStatus('question');
          this.scheduleStart(100);
        } else {
          this.mode = 'wake';
          this.silenceCycles = 0;
          this.options.onStatus('listening');
          this.scheduleStart(100);
        }
      }
    };

    try {
      this.options.onStatus(this.mode === 'wake' ? 'listening' : 'question');
      logWakeDiagnostic('calling_recognizer_start', { mode: this.mode, lang: recognizer.lang });
      recognizer.start();
    } catch (err: any) {
      const msg = String(err?.message || err?.name || '');
      logWakeDiagnostic('recognizer_start_exception', { error: msg });
      this.recognition = null;
      if (msg.includes('service-not-allowed') || msg.includes('not-allowed')) {
        this.active = false;
        this.stopCurrentRecognition('service_not_allowed_start');
        this.options.onStatus('unsupported');
        return;
      }
      this.scheduleStart(500);
    }
  }

  private onSpeechSilenceCompleted(sessionId: number) {
    if (!this.active || this.submitted) return;
    this.speechPauseTimer = undefined;
    const fullText = (this.transcript + (this.interimTranscript ? ' ' + this.interimTranscript : '')).trim() || this.lastSpeechText;
    const match = removeWakePhrase(fullText, this.options.phrase, this.options.assistantName);
    const q = (match.detected ? match.question : fullText).trim() || this.pendingQuestionText;

    if (q) {
      logWakeDiagnostic('speech_pause_2s_completed_submitting', {
        sessionId,
        question: q,
        elapsed: Date.now() - this.lastSpeechTime,
      });
      this.pendingQuestionText = '';
      this.stopCurrentRecognition('question_submitted');
      this.submit(q);
    } else {
      logWakeDiagnostic('wake_name_only_silence_waiting_for_user_question', { sessionId });
    }
  }

  private submit(question: string) {
    if (!this.active || this.submitted || !question.trim()) return;
    this.submitted = true;
    logWakeDiagnostic('submit_question', { question: question.trim() });
    this.stopCurrentRecognition();
    this.options.onStatus('processing');
    this.options.onQuestion(
      question.trim(),
      () => this.handleSpeakingEnd(),
      () => this.handleSpeakingError(),
      () => this.handleSpeakingStart()
    );
  }

  private handleSpeakingStart() {
    if (!this.active) return;
    logWakeDiagnostic('handle_speaking_start');
    this.stopCurrentRecognition();
    this.options.onStatus('speaking');
  }

  private handleSpeakingEnd() {
    if (!this.active) return;
    logWakeDiagnostic('handle_speaking_end');
    this.options.onStatus('waiting_for_answer');
    this.mode = 'question';
    this.submitted = false;
    this.attempts = 0;
    this.silenceCycles = 0;
    this.transcript = '';
    this.interimTranscript = '';
    this.lastSpeechText = '';
    this.lastSpeechTime = 0;
    this.pendingQuestionText = '';
    if (this.speechPauseTimer) {
      clearTimeout(this.speechPauseTimer);
      this.speechPauseTimer = undefined;
    }
    // Automatically restart recognition to listen for farmer's reply
    this.scheduleStart(80);
  }

  private handleSpeakingError() {
    if (!this.active) return;
    logWakeDiagnostic('handle_speaking_error');
    this.submitted = false;
    this.attempts = 0;
    this.silenceCycles = 0;
    this.transcript = '';
    this.interimTranscript = '';
    this.lastSpeechText = '';
    this.lastSpeechTime = 0;
    this.pendingQuestionText = '';
    if (this.speechPauseTimer) {
      clearTimeout(this.speechPauseTimer);
      this.speechPauseTimer = undefined;
    }
    this.mode = 'question';
    this.options.onStatus('question');
    this.scheduleStart(150);
  }

  private retryStart() {
    if (!this.active) return;
    if (this.attempts >= 3) {
      logWakeDiagnostic('max_attempts_reached_error');
      this.options.onStatus('error');
      this.active = false;
      return;
    }
    this.attempts += 1;
    logWakeDiagnostic('retry_reconnecting', { attempt: this.attempts });
    this.options.onStatus('reconnecting');
    this.scheduleStart(Math.min(500 * 2 ** (this.attempts - 1), 2000));
  }
}

export const DEFAULT_WAKE_PREFIXES: Record<SupportedLanguage, string> = {
  en: '', te: '', hi: '', ta: '', kn: '', ml: '', mr: '',
};
const DEFAULT_WAKE_PHRASES: Record<SupportedLanguage, string> = {
  en: 'Mitra', te: 'Mitra', hi: 'Mitra', ta: 'Mitra', kn: 'Mitra', ml: 'Mitra', mr: 'Mitra',
};

export function buildDefaultWakePhrase(name: string, _language: SupportedLanguage = 'en'): string {
  return (name || '').trim() || DEFAULT_ASSISTANT_NAME;
}

export function getWakePreferences(storage: Storage = localStorage, _language: SupportedLanguage = 'en') {
  let name = '';
  let configured = false;
  try {
    name = (storage.getItem('kisan_hita_wake_name') || '').trim();
    configured = storage.getItem('kisan_hita_wake_name_configured') === 'true';
  } catch {}

  // If storage didn't yield a configured name, check window.localStorage or window.sessionStorage
  if (!name && typeof window !== 'undefined') {
    const fallbacks = [window.localStorage, window.sessionStorage].filter((s) => s && s !== storage);
    for (const alt of fallbacks) {
      try {
        const altName = (alt.getItem('kisan_hita_wake_name') || '').trim();
        const altConfigured = alt.getItem('kisan_hita_wake_name_configured') === 'true';
        if (altName) {
          name = altName;
          configured = altConfigured;
          break;
        }
      } catch {}
    }
  }

  // Default to Mitra when unconfigured
  if (!name) {
    name = DEFAULT_ASSISTANT_NAME;
  }

  // ONE NAME = ONE EXACT WAKE PHRASE: The wake phrase is the exact configured assistant name alone
  const phrase = name;
  return { name, phrase };
}

export function saveWakePreferences(
  name: string,
  _phrase?: string,
  storage: Storage = localStorage,
  _language: SupportedLanguage = 'en'
) {
  const cleanName = (name || '').trim().slice(0, 40) || DEFAULT_ASSISTANT_NAME;
  const cleanPhrase = cleanName;

  try {
    storage.setItem('kisan_hita_wake_name', cleanName);
    storage.setItem('kisan_hita_wake_name_configured', 'true');

    // Synchronize across all 7 supported languages so no stale language phrase ever lingers
    const allLanguages: SupportedLanguage[] = ['en', 'te', 'hi', 'ta', 'kn', 'ml', 'mr'];
    for (const lang of allLanguages) {
      storage.setItem(`kisan_hita_wake_phrase_${lang}`, cleanPhrase);
    }
    storage.setItem('kisan_hita_wake_phrase', cleanPhrase);

    // Also mirror to window.localStorage and window.sessionStorage if available
    if (typeof window !== 'undefined') {
      const altStorages = [window.localStorage, window.sessionStorage].filter(
        (s) => s && s !== storage
      );
      for (const alt of altStorages) {
        try {
          alt.setItem('kisan_hita_wake_name', cleanName);
          alt.setItem('kisan_hita_wake_name_configured', 'true');
          for (const lang of allLanguages) {
            alt.setItem(`kisan_hita_wake_phrase_${lang}`, cleanPhrase);
          }
          alt.setItem('kisan_hita_wake_phrase', cleanPhrase);
        } catch {}
      }
    }
  } catch {}

  const eventTarget = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? (globalThis as any) : undefined);
  if (eventTarget && typeof eventTarget.dispatchEvent === 'function') {
    try {
      const Evt = typeof CustomEvent !== 'undefined' ? CustomEvent : (eventTarget as any).CustomEvent;
      if (Evt) {
        eventTarget.dispatchEvent(new Evt('kisan-hita:wake-preferences-updated'));
      }
    } catch {}
  }
  return { name: cleanName, phrase: cleanPhrase };
}

export interface PrismaAudioWakeOptions {
  language: SupportedLanguage;
  phrase: string;
  assistantName?: string;
  fetcher?: typeof fetch;
  MediaRecorderClass?: any;
  AudioContextClass?: any;
  followUpWindowMs?: number;
  sttTimeoutMs?: number;
  onStatus: (status: WakeStatus) => void;
  onError?: (error: 'permission' | 'no_microphone' | 'network' | 'timeout' | 'service' | 'empty_transcript' | 'unsupported_audio' | 'recording') => void;
  onQuestion: (
    text: string,
    onSpeakingEnd?: () => void,
    onSpeakingError?: () => void,
    onSpeakingStart?: () => void
  ) => void;
}

export class PrismaAudioWakeController {
  private active = false;
  private mode: 'wake' | 'question' = 'wake';
  private options: PrismaAudioWakeOptions;
  private stream: MediaStream | null = null;
  private recorder: any = null;
  private audioContext: any = null;
  private analyser: any = null;
  private animInterval: any = null;
  private chunks: any[] = [];
  private recordingStartTime = 0;
  private speechDetected = false;
  private speechSilenceTimer: any = null;
  private maxDurationTimer: any = null;
  private idleRecycleTimer: any = null;
  private followUpTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private uploadController: AbortController | null = null;
  private uploadGeneration = 0;
  private speechStartSamples = 0;
  private noiseFloor = 0.005;
  private submitted = false;
  private isProcessingUpload = false;

  constructor(options: PrismaAudioWakeOptions) {
    this.options = options;
  }

  get isActive() {
    return this.active;
  }

  async start(existingStream?: MediaStream) {
    if (this.active) return;
    this.active = true;
    this.submitted = false;
    this.mode = 'wake';
    this.speechDetected = false;
    this.clearAllTimers();
    this.clearFollowUpTimer();

    logWakeDiagnostic('prisma_controller_start', {
      language: this.options.language,
      phrase: this.options.phrase,
      assistantName: this.options.assistantName,
    });

    try {
      if (existingStream) {
        this.stream = existingStream;
      } else if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        logWakeDiagnostic('prisma_mic_unsupported');
        this.active = false;
        this.options.onStatus('unsupported');
        return;
      }
    } catch (err: any) {
      logWakeDiagnostic('prisma_mic_denied', { error: err?.name || err?.message });
      this.active = false;
      if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        this.options.onError?.('no_microphone');
        this.options.onStatus('error');
      } else {
        this.options.onError?.('permission');
        this.options.onStatus('permission');
      }
      return;
    }

    this.options.onStatus(this.mode === 'wake' ? 'listening' : 'question');
    if (!(await this.startAudioMonitoring())) {
      this.stop();
      this.options.onStatus('unsupported');
      return;
    }
    this.startRecordingSlice();
  }

  stop() {
    this.active = false;
    this.submitted = false;
    this.isProcessingUpload = false;
    this.uploadGeneration += 1;
    this.uploadController?.abort();
    this.uploadController = null;
    this.clearAllTimers();
    this.clearFollowUpTimer();
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    this.stopAudioMonitoring();
    this.stopRecordingSlice(true);
    if (this.stream) {
      try {
        this.stream.getTracks().forEach((track: any) => track.stop());
      } catch {}
      this.stream = null;
    }
    this.options.onStatus('disabled');
  }

  resume() {
    if (!this.active) return;
    this.handleSpeakingEnd();
  }

  updatePreferences(name: string, phrase?: string) {
    this.options.assistantName = name;
    if (phrase) this.options.phrase = phrase;
    logWakeDiagnostic('prisma_preferences_updated', { name, phrase: this.options.phrase });
  }

  updateLanguage(language: SupportedLanguage) {
    if (this.options.language === language) return;
    this.options.language = language;
    logWakeDiagnostic('prisma_language_updated', { language });
    if (this.active) {
      this.uploadGeneration += 1;
      this.uploadController?.abort();
      this.uploadController = null;
      this.isProcessingUpload = false;
      this.mode = 'wake';
      this.submitted = false;
      this.clearFollowUpTimer();
      this.stopRecordingSlice(true);
      this.startRecordingSlice();
    }
  }

  private clearFollowUpTimer() {
    if (this.followUpTimer) {
      clearTimeout(this.followUpTimer);
      this.followUpTimer = null;
    }
  }

  private clearAllTimers() {
    if (this.speechSilenceTimer) {
      clearTimeout(this.speechSilenceTimer);
      this.speechSilenceTimer = null;
    }
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
    if (this.idleRecycleTimer) {
      clearTimeout(this.idleRecycleTimer);
      this.idleRecycleTimer = null;
    }
  }

  private async startAudioMonitoring(): Promise<boolean> {
    this.stopAudioMonitoring();
    if (!this.stream) return false;

    const AudioCtx =
      this.options.AudioContextClass ||
      (typeof window !== 'undefined'
        ? (window as any).AudioContext || (window as any).webkitAudioContext
        : undefined);
    if (!AudioCtx) return false;

    try {
      const ctx = new AudioCtx();
      this.audioContext = ctx;
      if (ctx.state === 'suspended') {
        await ctx.resume();
        if (ctx.state !== 'running') {
          this.options.onError?.('recording');
          return false;
        }
      }
      const source = ctx.createMediaStreamSource(this.stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      this.analyser = analyser;

      const dataArray = new Uint8Array(analyser.fftSize);

      this.animInterval = setInterval(() => {
        if (!this.active || this.submitted || this.isProcessingUpload) return;
        analyser.getByteTimeDomainData(dataArray);
        let sumSquares = 0;
        for (const sample of dataArray) {
          const normalized = (sample - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);
        const threshold = Math.max(0.012, this.noiseFloor * 2.5);

        if (rms > threshold) {
          this.speechStartSamples += 1;
        } else {
          this.speechStartSamples = 0;
          if (!this.speechDetected) {
            this.noiseFloor = Math.min(0.08, this.noiseFloor * 0.9 + rms * 0.1);
          }
        }

        if (!this.speechDetected && this.speechStartSamples >= 2) {
          this.speechDetected = true;
          this.clearFollowUpTimer();
          logWakeDiagnostic('prisma_speech_detected_start', { level: rms, noiseFloor: this.noiseFloor });
        }

        if (this.speechDetected && rms > threshold) {
          if (this.speechSilenceTimer) {
            clearTimeout(this.speechSilenceTimer);
            this.speechSilenceTimer = null;
          }
        } else if (this.speechDetected) {
          if (!this.speechSilenceTimer) {
            logWakeDiagnostic('prisma_silence_timer_started_2000ms');
            this.speechSilenceTimer = setTimeout(() => {
              this.speechSilenceTimer = null;
              logWakeDiagnostic('prisma_silence_timer_fired_stopping_recorder');
              this.stopRecordingSlice(false);
            }, SPEECH_PAUSE_MS);
          }
        }
      }, 100);
      return true;
    } catch (err: any) {
      logWakeDiagnostic('prisma_audiocontext_init_error', { error: String(err) });
      this.options.onError?.('recording');
      this.stopAudioMonitoring();
      return false;
    }
  }

  private stopAudioMonitoring() {
    if (this.animInterval) {
      clearInterval(this.animInterval);
      this.animInterval = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close().catch(() => {});
      } catch {}
      this.audioContext = null;
      this.analyser = null;
    }
  }

  private startRecordingSlice() {
    if (!this.active || this.submitted || this.isProcessingUpload || !this.stream) return;
    this.clearAllTimers();
    this.chunks = [];
    this.recordingStartTime = Date.now();
    this.speechDetected = false;
    this.speechStartSamples = 0;

    const MediaRec =
      this.options.MediaRecorderClass ||
      (typeof window !== 'undefined' ? (window as any).MediaRecorder : undefined);
    if (!MediaRec) {
      this.stop();
      this.options.onStatus('unsupported');
      return;
    }
    const selectedMime = selectPrismaRecordingMime(MediaRec);
    if (!selectedMime) {
      this.options.onError?.('recording');
      this.stop();
      this.options.onStatus('unsupported');
      return;
    }

    try {
      const recorder = selectedMime
        ? new MediaRec(this.stream, { mimeType: selectedMime })
        : new MediaRec(this.stream);
      this.recorder = recorder;
      const actualMime = recorder.mimeType || selectedMime;
      if (!getPrismaRecordingExtension(actualMime)) {
        this.options.onError?.('unsupported_audio');
        this.stop();
        this.options.onStatus('unsupported');
        return;
      }

      recorder.ondataavailable = (event: any) => {
        const data = event.data;
        if (data && (data.size > 0 || data.byteLength > 0 || data.length > 0)) {
          this.chunks.push(data);
        }
      };

      recorder.onerror = (event: any) => {
        logWakeDiagnostic('prisma_recorder_error');
        if (this.active) {
          this.stop();
          this.options.onError?.('recording');
          this.options.onStatus('error');
        }
      };

      recorder.onstop = () => {
        const elapsed = (Date.now() - this.recordingStartTime) / 1000;
        const duration = Math.max(0.5, elapsed);
        const currentChunks = this.chunks;
        this.chunks = [];
        this.recorder = null;
        if (!this.active || this.submitted) return;
        if (this.speechDetected && currentChunks.length > 0) {
          const blob = new Blob(currentChunks, { type: actualMime });
          void this.processAudioBlob(blob, duration, actualMime);
        } else {
          if (this.active && !this.submitted && !this.isProcessingUpload) {
            this.startRecordingSlice();
          }
        }
      };

      recorder.start(250);
      logWakeDiagnostic('prisma_recorder_started', { mimeType: actualMime });

      // Max duration safeguard (25s)
      const maxTimer = setTimeout(() => {
        if (this.active && this.speechDetected && !this.submitted) {
          logWakeDiagnostic('prisma_max_duration_reached');
          this.stopRecordingSlice(false);
        }
      }, 25000);
      if (typeof (maxTimer as any)?.unref === 'function') {
        (maxTimer as any).unref();
      }
      this.maxDurationTimer = maxTimer;

      // Idle recycle (10s of complete silence)
      const idleTimer = setTimeout(() => {
        if (this.active && !this.speechDetected && !this.submitted && !this.isProcessingUpload) {
          this.stopRecordingSlice(false);
        }
      }, 10000);
      if (typeof (idleTimer as any)?.unref === 'function') {
        (idleTimer as any).unref();
      }
      this.idleRecycleTimer = idleTimer;
    } catch (err: any) {
      logWakeDiagnostic('prisma_recorder_start_exception', { error: String(err) });
      this.stop();
      this.options.onError?.('unsupported_audio');
      this.options.onStatus('unsupported');
    }
  }

  private stopRecordingSlice(cancel = false) {
    this.clearAllTimers();
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder && recorder.state !== 'inactive') {
      if (cancel) {
        recorder.onstop = null;
      }
      try {
        recorder.stop();
      } catch {}
    }
  }

  private async processAudioBlob(blob: Blob, duration: number, mimeType: string) {
    if (!this.active || this.submitted) return;
    if (blob.size === 0 || blob.size > 10 * 1024 * 1024) {
      this.options.onError?.('unsupported_audio');
      this.options.onStatus('error');
      this.startRecordingSlice();
      return;
    }
    this.isProcessingUpload = true;
    this.options.onStatus('processing');
    const extension = getPrismaRecordingExtension(mimeType);
    if (!extension || duration <= 0 || duration > 30) {
      this.isProcessingUpload = false;
      this.options.onError?.('unsupported_audio');
      this.options.onStatus('error');
      this.startRecordingSlice();
      return;
    }
    logWakeDiagnostic('prisma_uploading_audio', {
      language: this.options.language,
      bytes: blob.size,
      duration,
      mimeType,
    });

    const form = new FormData();
    form.append('file', blob, `speech.${extension}`);
    form.append('language', this.options.language);
    form.append('duration_seconds', String(duration));

    const fetcher =
      this.options.fetcher ||
      (typeof window !== 'undefined' ? window.fetch.bind(window) : fetch);
    const requestId = ++this.uploadGeneration;
    const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    this.uploadController = abortController;
    let timedOut = false;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      abortController?.abort();
    }, this.options.sttTimeoutMs ?? STT_REQUEST_TIMEOUT_MS);

    try {
      const res = await fetcher('/api/voice/stt/upload', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
        ...(abortController ? { signal: abortController.signal } : {}),
      });

      const data = await res.json().catch(() => null);
      if (!this.active || this.submitted || requestId !== this.uploadGeneration) return;

      if (!res.ok) {
        logWakeDiagnostic('prisma_upload_error_response', { status: res.status, detail: data?.detail });
        this.isProcessingUpload = false;
        this.options.onError?.(res.status === 400 || res.status === 413 || res.status === 415
          ? 'unsupported_audio'
          : 'service');
        this.options.onStatus('error');
        this.options.onStatus(this.mode === 'wake' ? 'listening' : 'question');
        this.startRecordingSlice();
        return;
      }

      const transcript = (typeof data?.transcript === 'string' ? data.transcript : '').trim();
      logWakeDiagnostic('prisma_transcript_received', { transcript, mode: this.mode });

      if (!transcript) {
        this.isProcessingUpload = false;
        this.options.onError?.('empty_transcript');
        this.options.onStatus('error');
        this.options.onStatus(this.mode === 'wake' ? 'listening' : 'question');
        this.startRecordingSlice();
        return;
      }

      this.isProcessingUpload = false;
      this.handleTranscript(transcript);
    } catch (err: any) {
      if (requestId !== this.uploadGeneration || !this.active || this.submitted) return;
      logWakeDiagnostic('prisma_upload_exception', { error: err?.message });
      this.isProcessingUpload = false;
      if (this.active && !this.submitted) {
        this.options.onError?.(timedOut ? 'timeout' : 'network');
        this.options.onStatus('error');
        this.options.onStatus(this.mode === 'wake' ? 'listening' : 'question');
        this.startRecordingSlice();
      }
    } finally {
      clearTimeout(timeoutTimer);
      if (this.uploadController === abortController) this.uploadController = null;
    }
  }

  private handleTranscript(transcript: string) {
    if (!this.active || this.submitted) return;
    const match = removeWakePhrase(transcript, this.options.phrase, this.options.assistantName);
    logWakeDiagnostic('prisma_handle_transcript', {
      transcript,
      mode: this.mode,
      detected: match.detected,
      question: match.question,
    });

    if (this.mode === 'wake') {
      if (match.detected) {
        this.options.onStatus('detected');
        if (match.question) {
          this.submit(match.question);
        } else {
          logWakeDiagnostic('prisma_wake_word_only_waiting_for_question');
          this.mode = 'question';
          this.options.onStatus('question');
          this.startRecordingSlice();
        }
      } else {
        this.options.onStatus('listening');
        this.startRecordingSlice();
      }
    } else {
      let q = transcript;
      if (match.detected) {
        if (match.question) {
          q = match.question;
        } else {
          this.options.onStatus('question');
          this.startRecordingSlice();
          return;
        }
      }
      if (q) {
        this.submit(q);
      } else {
        this.options.onStatus('question');
        this.startRecordingSlice();
      }
    }
  }

  private submit(question: string) {
    if (!this.active || this.submitted || !question.trim()) return;
    this.submitted = true;
    this.clearAllTimers();
    this.clearFollowUpTimer();
    this.stopRecordingSlice(true);
    logWakeDiagnostic('prisma_submit_question', { question });
    this.options.onStatus('processing');
    this.options.onQuestion(
      question.trim(),
      () => this.handleSpeakingEnd(),
      () => this.handleSpeakingError(),
      () => this.handleSpeakingStart()
    );
  }

  private handleSpeakingStart() {
    if (!this.active) return;
    logWakeDiagnostic('prisma_speaking_start');
    this.clearFollowUpTimer();
    this.stopRecordingSlice(true);
    this.options.onStatus('speaking');
  }

  private handleSpeakingEnd() {
    if (!this.active) return;
    logWakeDiagnostic('prisma_speaking_end');
    this.options.onStatus('waiting_for_answer');
    this.mode = 'question';
    this.submitted = false;
    this.speechDetected = false;
    this.speechStartSamples = 0;
    this.clearFollowUpTimer();
    this.followUpTimer = setTimeout(() => {
      this.followUpTimer = null;
      if (!this.active || this.submitted || this.speechDetected || this.isProcessingUpload) return;
      this.mode = 'wake';
      this.options.onStatus('listening');
      logWakeDiagnostic('prisma_follow_up_window_expired');
    }, this.options.followUpWindowMs ?? FOLLOW_UP_WINDOW_MS);
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      if (this.active && !this.submitted) {
        this.startRecordingSlice();
      }
    }, 100);
  }

  private handleSpeakingError() {
    if (!this.active) return;
    logWakeDiagnostic('prisma_speaking_error');
    this.submitted = false;
    this.mode = 'question';
    this.speechDetected = false;
    this.speechStartSamples = 0;
    this.options.onStatus('question');
    this.clearFollowUpTimer();
    this.followUpTimer = setTimeout(() => {
      this.followUpTimer = null;
      if (!this.active || this.submitted || this.speechDetected || this.isProcessingUpload) return;
      this.mode = 'wake';
      this.options.onStatus('listening');
      logWakeDiagnostic('prisma_follow_up_window_expired');
    }, this.options.followUpWindowMs ?? FOLLOW_UP_WINDOW_MS);
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      if (this.active && !this.submitted) {
        this.startRecordingSlice();
      }
    }, 200);
  }
}
