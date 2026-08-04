import type { QuizQuestion, QuizRefreshMeta, VocabEntry } from '../types';

const API_KEY = 'chineseLearning.geminiApiKey';
const MODEL_KEY = 'chineseLearning.geminiModel';
const LEARNED_AVG_SEC_KEY = 'chineseLearning.learnedAvgSeconds';

/** Session-only: which profile is open (not word data). */
const ACTIVE_PROFILE_ID_SESSION = 'chineseLearning.activeProfileId';

/** Legacy keys to scrub — word DB must not live in the browser. */
const LEGACY_BROWSER_KEYS = [
  'chineseLearning.quizRefreshMeta',
  'chineseLearning.storageMode',
  'chineseLearning.syncUrl',
  'chineseLearning.syncKey',
  'chineseLearning.lastSyncAt',
  'chineseLearning.syncProfiles',
  'chineseLearning.activeProfileId',
  'chineseLearning.library',
  'chineseLearning.entries',
  'chineseLearning.quizQuestions',
];

/** Default: card counts as learned when avg response ≤ this many seconds. */
export const DEFAULT_LEARNED_AVG_SECONDS = 4;
export const MIN_LEARNED_AVG_SECONDS = 2;
export const MAX_LEARNED_AVG_SECONDS = 10;

export const GEMINI_MODELS = [
  {
    id: 'gemini-3.1-flash-lite',
    label: '3.1 Flash Lite (best free / cheap)',
  },
  {
    id: 'gemini-3.5-flash',
    label: '3.5 Flash (smarter)',
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: '2.5 Flash Lite (fallback)',
  },
  {
    id: 'gemini-2.5-flash',
    label: '2.5 Flash (fallback)',
  },
] as const;

export type GeminiModelId = (typeof GEMINI_MODELS)[number]['id'];

export const DEFAULT_GEMINI_MODEL: GeminiModelId = 'gemini-3.1-flash-lite';

export type GroveSnapshot = {
  updatedAt: number;
  entries: VocabEntry[];
  quizQuestions: QuizQuestion[];
  quizRefreshMeta: QuizRefreshMeta | null;
};

export type SyncProfile = {
  id: string;
  name: string;
  syncKey: string;
  createdAt?: number;
};

/** Same-origin by default (nginx proxies /api → grove-sync). */
export function getApiBase(): string {
  return '';
}

export function getApiKey(): string {
  return localStorage.getItem(API_KEY) ?? '';
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY, key.trim());
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY);
}

export function getGeminiModel(): GeminiModelId {
  const stored = localStorage.getItem(MODEL_KEY);
  if (GEMINI_MODELS.some((m) => m.id === stored)) {
    return stored as GeminiModelId;
  }
  if (stored === 'gemini-2.0-flash' || stored === 'gemini-2.0-flash-lite') {
    return DEFAULT_GEMINI_MODEL;
  }
  return DEFAULT_GEMINI_MODEL;
}

export function setGeminiModel(model: GeminiModelId): void {
  localStorage.setItem(MODEL_KEY, model);
}

export function getLearnedAvgSeconds(): number {
  const raw = localStorage.getItem(LEARNED_AVG_SEC_KEY);
  if (raw == null) return DEFAULT_LEARNED_AVG_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LEARNED_AVG_SECONDS;
  return Math.min(MAX_LEARNED_AVG_SECONDS, Math.max(MIN_LEARNED_AVG_SECONDS, n));
}

export function setLearnedAvgSeconds(seconds: number): void {
  const clamped = Math.min(
    MAX_LEARNED_AVG_SECONDS,
    Math.max(MIN_LEARNED_AVG_SECONDS, seconds),
  );
  localStorage.setItem(LEARNED_AVG_SEC_KEY, String(clamped));
}

export function getLearnedAvgMs(): number {
  return getLearnedAvgSeconds() * 1000;
}

/** In-memory quiz meta for the active profile (also stored on the server snapshot). */
let quizRefreshMetaMemory: QuizRefreshMeta | null = null;

export function getQuizRefreshMeta(): QuizRefreshMeta | null {
  return quizRefreshMetaMemory;
}

export function setQuizRefreshMeta(meta: QuizRefreshMeta | null): void {
  quizRefreshMetaMemory = meta;
}

export function getActiveProfileId(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_PROFILE_ID_SESSION);
  } catch {
    return null;
  }
}

export function setActiveProfileId(id: string): void {
  try {
    sessionStorage.setItem(ACTIVE_PROFILE_ID_SESSION, id);
  } catch {
    /* ignore */
  }
}

/**
 * Drop legacy browser copies of the word DB / sync config.
 * Keeps Gemini API key (and model / learned-threshold prefs).
 */
export function scrubLegacyBrowserStorage(): { legacySyncKey: string | null } {
  let legacySyncKey: string | null = null;
  try {
    const rawKey = localStorage.getItem('chineseLearning.syncKey');
    if (rawKey && rawKey.trim().length >= 8) legacySyncKey = rawKey.trim();
  } catch {
    /* ignore */
  }

  for (const key of LEGACY_BROWSER_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  return { legacySyncKey };
}
