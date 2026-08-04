import type { QuizQuestion, QuizRefreshMeta, VocabEntry } from '../types';

const API_KEY = 'chineseLearning.geminiApiKey';
const MODEL_KEY = 'chineseLearning.geminiModel';
const LEARNED_AVG_SEC_KEY = 'chineseLearning.learnedAvgSeconds';
const QUIZ_REFRESH_KEY = 'chineseLearning.quizRefreshMeta';
const STORAGE_MODE_KEY = 'chineseLearning.storageMode';
const SYNC_URL_KEY = 'chineseLearning.syncUrl';
const SYNC_KEY_KEY = 'chineseLearning.syncKey';
const LAST_SYNC_AT_KEY = 'chineseLearning.lastSyncAt';

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

export type StorageMode = 'local' | 'sync';

export type GroveSnapshot = {
  updatedAt: number;
  entries: VocabEntry[];
  quizQuestions: QuizQuestion[];
  quizRefreshMeta: QuizRefreshMeta | null;
};

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

export function getStorageMode(): StorageMode {
  return localStorage.getItem(STORAGE_MODE_KEY) === 'sync' ? 'sync' : 'local';
}

export function setStorageMode(mode: StorageMode): void {
  localStorage.setItem(STORAGE_MODE_KEY, mode);
}

/** Base URL of the sync server, e.g. http://100.x.x.x:8090 (no trailing slash). */
export function getSyncUrl(): string {
  return (localStorage.getItem(SYNC_URL_KEY) ?? '').trim().replace(/\/$/, '');
}

export function setSyncUrl(url: string): void {
  localStorage.setItem(SYNC_URL_KEY, url.trim().replace(/\/$/, ''));
}

export function getSyncKey(): string {
  return (localStorage.getItem(SYNC_KEY_KEY) ?? '').trim();
}

export function setSyncKey(key: string): void {
  localStorage.setItem(SYNC_KEY_KEY, key.trim());
}

export function getLastSyncAt(): number | null {
  const raw = localStorage.getItem(LAST_SYNC_AT_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function setLastSyncAt(ts: number): void {
  localStorage.setItem(LAST_SYNC_AT_KEY, String(ts));
}

export function clearLastSyncAt(): void {
  localStorage.removeItem(LAST_SYNC_AT_KEY);
}

export function isSyncConfigured(): boolean {
  const key = getSyncKey();
  return getStorageMode() === 'sync' && Boolean(getSyncUrl()) && key.length >= 8;
}

export type SyncProfile = {
  id: string;
  name: string;
  syncKey: string;
};

const PROFILES_KEY = 'chineseLearning.syncProfiles';
const ACTIVE_PROFILE_ID_KEY = 'chineseLearning.activeProfileId';

function slugifyProfile(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return slug || 'profile';
}

/** Server keys must be 8–64 chars: letters, numbers, _ - */
export function makeProfileSyncKey(name: string): string {
  const slug = slugifyProfile(name);
  const rand = Math.random().toString(36).slice(2, 10);
  return `grove-${slug}-${rand}`.slice(0, 64);
}

export function getSyncProfiles(): SyncProfile[] {
  const raw = localStorage.getItem(PROFILES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SyncProfile[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p) => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.syncKey === 'string',
    );
  } catch {
    return [];
  }
}

export function setSyncProfiles(profiles: SyncProfile[]): void {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

export function getActiveProfileId(): string | null {
  return localStorage.getItem(ACTIVE_PROFILE_ID_KEY);
}

export function setActiveProfileId(id: string): void {
  localStorage.setItem(ACTIVE_PROFILE_ID_KEY, id);
}

/**
 * Ensure at least one profile exists. Migrates the current sync key into "Nikko"
 * when enabling profiles for the first time.
 */
export function ensureSyncProfiles(): SyncProfile[] {
  let profiles = getSyncProfiles();
  if (profiles.length > 0) {
    const activeId = getActiveProfileId();
    const active = profiles.find((p) => p.id === activeId) ?? profiles[0]!;
    if (getActiveProfileId() !== active.id) setActiveProfileId(active.id);
    if (getSyncKey() !== active.syncKey) setSyncKey(active.syncKey);
    return profiles;
  }

  const existingKey = getSyncKey();
  const nikko: SyncProfile = {
    id: crypto.randomUUID(),
    name: 'Nikko',
    syncKey: existingKey.length >= 8 ? existingKey : makeProfileSyncKey('Nikko'),
  };
  profiles = [nikko];
  setSyncProfiles(profiles);
  setActiveProfileId(nikko.id);
  setSyncKey(nikko.syncKey);
  return profiles;
}

export function getActiveProfile(): SyncProfile | null {
  const profiles = ensureSyncProfiles();
  const id = getActiveProfileId();
  return profiles.find((p) => p.id === id) ?? profiles[0] ?? null;
}

export function upsertSyncProfile(profile: SyncProfile): SyncProfile[] {
  const profiles = getSyncProfiles();
  const idx = profiles.findIndex((p) => p.id === profile.id);
  if (idx >= 0) profiles[idx] = profile;
  else profiles.push(profile);
  setSyncProfiles(profiles);
  return profiles;
}

export function removeSyncProfile(id: string): SyncProfile[] {
  const next = getSyncProfiles().filter((p) => p.id !== id);
  setSyncProfiles(next);
  return next;
}
