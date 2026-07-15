import type { QuizRefreshMeta } from '../types';

const API_KEY = 'chineseLearning.geminiApiKey';
const MODEL_KEY = 'chineseLearning.geminiModel';
const LEARNED_AVG_SEC_KEY = 'chineseLearning.learnedAvgSeconds';
const QUIZ_REFRESH_KEY = 'chineseLearning.quizRefreshMeta';

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
  // Migrate away from shut-down 2.0 models
  if (
    stored === 'gemini-2.0-flash' ||
    stored === 'gemini-2.0-flash-lite'
  ) {
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

export function getQuizRefreshMeta(): QuizRefreshMeta | null {
  const raw = localStorage.getItem(QUIZ_REFRESH_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as QuizRefreshMeta;
  } catch {
    return null;
  }
}

export function setQuizRefreshMeta(meta: QuizRefreshMeta): void {
  localStorage.setItem(QUIZ_REFRESH_KEY, JSON.stringify(meta));
}
