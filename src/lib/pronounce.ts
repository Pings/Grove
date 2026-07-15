import { getApiKey } from './settings';

const TTS_MODELS = [
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts',
] as const;

/** Natural Mandarin voice from Gemini’s prebuilt set. */
const TTS_VOICE = 'Kore';
const SAMPLE_RATE = 24000;

const audioCache = new Map<string, string>();
let currentAudio: HTMLAudioElement | null = null;

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

async function fetchGeminiTts(hanzi: string, apiKey: string, model: string): Promise<string> {
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
          parts: [
            {
              // Exact-text TTS — better for vocab drill than conversational Live API.
              text: `用标准普通话、清楚自然地朗读：${hanzi}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
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
  return (
    voices.find((v) => /^zh(-|$)/i.test(v.lang) && /CN|Hans|China|Chinese/i.test(v.lang + v.name)) ||
    voices.find((v) => /^zh/i.test(v.lang)) ||
    voices.find((v) => /Chinese|Mandarin|Putonghua|中文|普通话/i.test(v.name)) ||
    null
  );
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
      utter.rate = 0.9;
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
 * Pronounce Chinese with Gemini TTS when an API key is set;
 * otherwise fall back to the browser’s zh-CN voice.
 */
export async function pronounceHanzi(hanzi: string): Promise<void> {
  const text = hanzi.replace(/\s+/g, '').trim();
  if (!text) return;

  const apiKey = getApiKey();
  if (apiKey) {
    const cached = audioCache.get(text);
    if (cached) {
      await playUrl(cached);
      return;
    }

    let lastErr: unknown;
    for (const model of TTS_MODELS) {
      try {
        const url = await fetchGeminiTts(text, apiKey, model);
        audioCache.set(text, url);
        await playUrl(url);
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    // Fall through to browser voice if Gemini TTS is unavailable.
    console.warn('Gemini TTS unavailable, using browser voice.', lastErr);
  }

  await speakWithBrowser(text);
}
