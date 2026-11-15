const SUPPORTED_MIME_TYPES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/wav',
  'audio/mpeg',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/flac',
  'audio/aac',
];

const FILE_EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
};

export function selectPrismaRecordingMime(MediaRecorderClass: typeof MediaRecorder | undefined): string | null {
  if (!MediaRecorderClass || typeof MediaRecorderClass.isTypeSupported !== 'function') return null;
  return SUPPORTED_MIME_TYPES.find((mimeType) => MediaRecorderClass.isTypeSupported(mimeType)) || null;
}

function baseMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0].trim().toLowerCase();
}

export function getPrismaRecordingExtension(mimeType: string): string | null {
  return FILE_EXTENSIONS[baseMimeType(mimeType)] || null;
}

/**
 * Encodes a mono Float32Array of audio samples into a standard 16-bit PCM WAV Blob.
 * Used for Chrome and Android compatibility where MediaRecorder only provides WebM.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const intSample = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/** Native Web Audio PCM recorder for Chrome, Chromium and Android devices. */
export class WebAudioPcmRecorder {
  private audioContext: any = null;
  private source: any = null;
  private processor: any = null;
  private recordedBuffers: Float32Array[] = [];
  private totalSamples = 0;
  private startedAt = 0;

  start(stream: MediaStream): void {
    const AudioCtx = (typeof window !== 'undefined' && ((window as any).AudioContext || (window as any).webkitAudioContext))
      || (typeof globalThis !== 'undefined' && ((globalThis as any).AudioContext || (globalThis as any).webkitAudioContext));
    if (!AudioCtx) throw new Error('Web Audio is not supported in this browser.');

    this.audioContext = new AudioCtx();
    this.source = this.audioContext.createMediaStreamSource(stream);
    this.processor = this.audioContext.createScriptProcessor ? this.audioContext.createScriptProcessor(4096, 1, 1) : null;
    if (!this.processor) throw new Error('Web Audio ScriptProcessor is not available.');

    this.recordedBuffers = [];
    this.totalSamples = 0;
    this.startedAt = Date.now();

    this.processor.onaudioprocess = (e: any) => {
      const input = e.inputBuffer.getChannelData(0);
      const clone = new Float32Array(input.length);
      clone.set(input);
      this.recordedBuffers.push(clone);
      this.totalSamples += clone.length;
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  stop(): RecordedPrismaAudio {
    if (!this.audioContext) throw new Error('Web Audio recording is not active.');
    const sampleRate = this.audioContext.sampleRate || 16000;
    const durationSeconds = Math.max(0.01, (Date.now() - this.startedAt) / 1000);

    if (this.processor) {
      this.processor.onaudioprocess = null;
      try { this.processor.disconnect(); } catch {}
      this.processor = null;
    }
    if (this.source) {
      try { this.source.disconnect(); } catch {}
      this.source = null;
    }
    try {
      this.audioContext.close();
    } catch {}
    this.audioContext = null;

    const merged = new Float32Array(this.totalSamples);
    let offset = 0;
    for (const buf of this.recordedBuffers) {
      merged.set(buf, offset);
      offset += buf.length;
    }
    this.recordedBuffers = [];
    this.totalSamples = 0;

    const blob = encodeWav(merged, sampleRate);
    return {
      blob,
      durationSeconds,
      mimeType: 'audio/wav',
      filename: 'recording.wav',
    };
  }

  cancel(): void {
    if (this.processor) {
      this.processor.onaudioprocess = null;
      try { this.processor.disconnect(); } catch {}
      this.processor = null;
    }
    if (this.source) {
      try { this.source.disconnect(); } catch {}
      this.source = null;
    }
    if (this.audioContext) {
      try { this.audioContext.close(); } catch {}
      this.audioContext = null;
    }
    this.recordedBuffers = [];
    this.totalSamples = 0;
  }
}

export interface RecordedPrismaAudio {
  blob: Blob;
  mimeType: string;
  filename: string;
  durationSeconds: number;
}

/** Records a deliberate, foreground clip initiated by the user. */
export class PrismaManualRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private webAudioRecorder: WebAudioPcmRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private resultPromise: Promise<RecordedPrismaAudio> | null = null;

  async start(existingStream?: MediaStream): Promise<void> {
    const MediaRecorderClass = typeof MediaRecorder !== 'undefined' ? MediaRecorder : undefined;
    const AudioCtxClass = (typeof window !== 'undefined' && ((window as any).AudioContext || (window as any).webkitAudioContext))
      || (typeof globalThis !== 'undefined' && ((globalThis as any).AudioContext || (globalThis as any).webkitAudioContext));

    if (!MediaRecorderClass && !AudioCtxClass) {
      throw new Error('Manual audio recording is not supported in this browser.');
    }

    this.stream = existingStream || await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = selectPrismaRecordingMime(MediaRecorderClass);

    // If MediaRecorder supports a Prisma-accepted format (e.g. Safari audio/mp4), use MediaRecorder
    if (MediaRecorderClass && mimeType) {
      this.chunks = [];
      try {
        this.recorder = new MediaRecorderClass(this.stream, { mimeType });
      } catch {
        this.releaseStream();
        throw new Error('This browser cannot start a recording in an audio format supported by Prisma v3.0.');
      }
      const actualMime = this.recorder.mimeType || mimeType;
      const extension = FILE_EXTENSIONS[baseMimeType(actualMime)];
      if (!extension) {
        this.recorder = null;
        this.releaseStream();
        throw new Error('This browser produced an audio format Prisma v3.0 cannot accept.');
      }
      this.resultPromise = new Promise((resolve, reject) => {
        const activeRecorder = this.recorder!;
        activeRecorder.ondataavailable = (event) => { if (event.data?.size) this.chunks.push(event.data); };
        activeRecorder.onerror = () => {
          if (this.recorder === activeRecorder) this.recorder = null;
          this.releaseStream();
          reject(new Error('Audio recording failed.'));
        };
        activeRecorder.onstop = () => {
          if (this.recorder === activeRecorder) this.recorder = null;
          const durationSeconds = (Date.now() - this.startedAt) / 1000;
          const blob = new Blob(this.chunks, { type: actualMime });
          this.releaseStream();
          if (!blob.size) reject(new Error('The recording is empty.'));
          else resolve({ blob, mimeType: actualMime, filename: `recording.${extension}`, durationSeconds });
        };
        this.startedAt = Date.now();
      });
      try {
        this.recorder.start(250);
        return;
      } catch (error) {
        this.releaseStream();
        this.recorder = null;
        this.resultPromise = null;
        throw error;
      }
    }

    // Fallback: Web Audio API PCM WAV recording (for Chrome, Android, Edge)
    if (AudioCtxClass) {
      try {
        this.webAudioRecorder = new WebAudioPcmRecorder();
        this.webAudioRecorder.start(this.stream);
        this.startedAt = Date.now();
        return;
      } catch {
        this.webAudioRecorder = null;
        this.releaseStream();
        throw new Error('This browser cannot start a Web Audio recording.');
      }
    }

    this.releaseStream();
    throw new Error('This browser cannot record an audio format supported by Prisma.');
  }

  async stop(): Promise<RecordedPrismaAudio> {
    if (this.webAudioRecorder) {
      try {
        const result = this.webAudioRecorder.stop();
        this.webAudioRecorder = null;
        this.releaseStream();
        if (!result.blob.size) throw new Error('The recording is empty.');
        return result;
      } catch (err) {
        this.webAudioRecorder = null;
        this.releaseStream();
        throw err;
      }
    }

    const recorder = this.recorder;
    if (!recorder || !this.resultPromise) throw new Error('No Prisma recording is active.');
    const resultPromise = this.resultPromise;
    if (recorder.state !== 'inactive') recorder.stop();
    this.recorder = null;
    return resultPromise;
  }

  cancel(): void {
    if (this.webAudioRecorder) {
      this.webAudioRecorder.cancel();
      this.webAudioRecorder = null;
    }
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      try { recorder.stop(); } catch {}
    }
    this.releaseStream();
    this.chunks = [];
    this.resultPromise = null;
  }

  private releaseStream() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}

export async function uploadPrismaRecording(
  recording: RecordedPrismaAudio,
  language: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (recording.durationSeconds <= 0 || recording.durationSeconds > 30) {
    throw new Error('Prisma v3.0 accepts recordings up to 30 seconds.');
  }
  const mimeType = baseMimeType(recording.mimeType);
  const extension = FILE_EXTENSIONS[mimeType];
  if (!extension || recording.filename !== `recording.${extension}`) {
    throw new Error('The recording format and filename do not match a Prisma-supported audio type.');
  }
  if (recording.blob.type && baseMimeType(recording.blob.type) !== mimeType) {
    throw new Error('The recording MIME type does not match the audio data.');
  }
  const form = new FormData();
  form.append('file', recording.blob, recording.filename);
  form.append('language', language);
  form.append('duration_seconds', String(recording.durationSeconds));
  const response = await fetcher('/api/voice/stt/upload', {
    method: 'POST',
    credentials: 'same-origin',
    body: form,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Prisma transcription failed.');
  if (typeof data?.transcript !== 'string' || !data.transcript.trim()) throw new Error('Prisma returned no usable transcript.');
  return data.transcript.trim();
}
