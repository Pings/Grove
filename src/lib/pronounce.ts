import { getApiKey } from './settings';

/** Prefer a single modern TTS model so tone drills sound consistent. */
const TTS_MODEL = 'gemini-3.1-flash-tts-preview';
/** Only if 3.1 is unavailable (quota / not enabled on the key). */
const TTS_FALLBACK_MODEL = 'gemini-2.5-flash-preview-tts';

/** Stable Mandarin-friendly prebuilt voice (Gemini TTS). */
const TTS_VOICE = 'Kore';
/** Mandarin Chinese — keeps pronunciation from drifting to other languages. */
const TTS_LANGUAGE = 'cmn-CN';
const SAMPLE_RATE = 24000;

export type PronounceOptions = {
  /**
   * Tend tone drills: ask for clear citation (dictionary) tones so the
   * spoken contour matches the answer key (incl. full 3rd tones).
   */
  citationTones?: boolean;
};

const audioCache = new Map<string, string>();
let currentAudio: HTMLAudioElement | null = null;
/** Remember which Gemini model succeeded this session — stick to it. */
let preferredModel: string | null = null;

export function stopPronouncing() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

function cacheKey(hanzi: string, options: PronounceOptions): string {
  return `${TTS_VOICE}|${options.citationTones ? 'cite' : 'nat'}|${hanzi}`;
}

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Wrap raw PCM (s16le mono) in a minimal WAV container for Audio playback. */
function pcmToWavBlob(pcm: Uint8Array, sampleRate = SAMPLE_RATE): Blob {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcm.length, true);
  return new Blob([header, new Uint8Array(pcm)], { type: 'audio/wav' });
}

function ttsPrompt(hanzi: string, citationTones: boolean): string {
  if (citationTones) {
    return (
      `Read this Mandarin Chinese clearly and slowly for a tone-training drill. ` +
      `Use standard Putonghua (cmn-CN). Pronounce each character with its full ` +
      `dictionary citation tone (complete dipping third tone; do not apply tone sandhi). ` +
      `No English. Text only: ${hanzi}`
    );
  }
  return (
    `Read this Mandarin Chinese clearly in natural standard Putonghua (cmn-CN). ` +
    `No English. Text only: ${hanzi}`
  );
}

async function fetchGeminiTts(
  hanzi: string,
  apiKey: string,
  model: string,
  options: PronounceOptions,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: ttsPrompt(hanzi, Boolean(options.citationTones)) }],
        },
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          languageCode: TTS_LANGUAGE,
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: TTS_VOICE,
            },
          },
        },
      },
    }),
  });

  const body = (await res.json()) as {
    error?: { message?: string };
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
    }>;
  };

  if (!res.ok) {
    throw new Error(body.error?.message || `TTS failed (${res.status})`);
  }

  const part = body.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  const data = part?.data;
  if (!data) throw new Error('No audio returned from Gemini TTS.');

  const bytes = base64ToBytes(data);
  const mime = part?.mimeType ?? '';
  const payload = new Uint8Array(bytes);
  const wav =
    /wav|mpeg|mp3|ogg|webm/i.test(mime)
      ? new Blob([payload], { type: mime || 'audio/wav' })
      : pcmToWavBlob(payload);
  return URL.createObjectURL(wav);
}

async function playUrl(url: string): Promise<void> {
  stopPronouncing();
  const audio = new Audio(url);
  currentAudio = audio;
  await audio.play();
  await new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    audio.onerror = () => {
      if (currentAudio === audio) currentAudio = null;
      reject(new Error('Could not play audio.'));
    };
  });
}

function pickZhVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  // Prefer Google / enhanced Mainland voices when the OS exposes them.
  const scored = voices
    .filter((v) => /^zh/i.test(v.lang) || /Chinese|Mandarin|Putonghua|中文|普通话/i.test(v.name))
    .map((v) => {
      let score = 0;
      const blob = `${v.lang} ${v.name}`;
      if (/zh-CN|cmn-CN|Hans/i.test(blob)) score += 40;
      if (/Google|Enhanced|Neural|Premium|Tingting|Xiaoxiao|Yaoyao/i.test(blob)) score += 30;
      if (/CN|China/i.test(blob)) score += 10;
      if (/TW|HK|yue|Cantonese/i.test(blob)) score -= 20;
      return { v, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.v ?? null;
}

function speakWithBrowser(hanzi: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error('Speech not supported in this browser.'));
      return;
    }
    stopPronouncing();

    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      const utter = new SpeechSynthesisUtterance(hanzi);
      utter.lang = 'zh-CN';
      utter.rate = 0.85;
      const voice = pickZhVoice();
      if (voice) utter.voice = voice;
      utter.onend = () => resolve();
      utter.onerror = () => reject(new Error('Browser speech failed.'));
      window.speechSynthesis.speak(utter);
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => start();
      window.setTimeout(start, 250);
    } else {
      start();
    }
  });
}

/**
 * Pronounce Chinese with Gemini 3.1 Flash TTS when an API key is set.
 * Sticks to one model/voice per session so tone drills stay consistent.
 * Browser speech is only used when there is no API key (or Gemini TTS fails hard).
 */
export async function pronounceHanzi(
  hanzi: string,
  options: PronounceOptions = {},
): Promise<void> {
  const text = hanzi.replace(/\s+/g, '').trim();
  if (!text) return;

  const apiKey = getApiKey();
  if (apiKey) {
    const key = cacheKey(text, options);
    const cached = audioCache.get(key);
    if (cached) {
      await playUrl(cached);
      return;
    }

    const models = preferredModel
      ? [preferredModel, ...[TTS_MODEL, TTS_FALLBACK_MODEL].filter((m) => m !== preferredModel)]
      : [TTS_MODEL, TTS_FALLBACK_MODEL];

    let lastErr: unknown;
    for (const model of models) {
      try {
        const url = await fetchGeminiTts(text, apiKey, model, options);
        preferredModel = model;
        audioCache.set(key, url);
        await playUrl(url);
        return;
      } catch (err) {
        lastErr = err;
      }
    }

    // Avoid silently switching to a robotic browser voice mid-session —
    // that is what made tone drills feel like “two different models”.
    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr ?? '');
    throw new Error(
      `Gemini TTS unavailable (${detail || 'unknown error'}). Check your API key / quota, then try again.`,
    );
  }

  await speakWithBrowser(text);
}
