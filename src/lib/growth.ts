import type { VocabEntry } from '../types';
import { avgResponseMs, isPerformanceLearned } from './flashcards';

/** 0 seed → 5 fully learned */
export type GrowthStage = 0 | 1 | 2 | 3 | 4 | 5;

/** Future: swap emoji for your own assets keyed by stage (+ wilt). */
export type PlantVariant = 'default';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days past due before the plant wilts and needs Tend. */
export const WATERING_OVERDUE_DAYS = 2;
/** Unused new cards wilt after this many days with no reviews. */
export const WATERING_NEVER_REVIEWED_DAYS = 7;

export function growthStage(
  entry: VocabEntry,
  thresholdMs: number,
  minReviews = 3,
): GrowthStage {
  if (isPerformanceLearned(entry, thresholdMs, minReviews)) return 5;

  const count = entry.responseCount ?? 0;
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;

  const avg = avgResponseMs(entry);
  const right = entry.correctCount ?? 0;
  const wrong = entry.wrongCount ?? 0;
  const reviews = right + wrong;
  const accuracy = reviews === 0 ? 0.5 : right / reviews;

  const nearSpeed = avg != null && avg <= thresholdMs * 1.4;
  const solidAcc = accuracy >= 0.65;
  if (count >= minReviews && nearSpeed && solidAcc) return 4;
  if (count >= 4 || (avg != null && avg <= thresholdMs * 2)) return 3;
  return 2;
}

export function growthLabel(stage: GrowthStage): string {
  return ['Seed', 'Sprout', 'Seedling', 'Young', 'Growing', 'Learned'][stage];
}

/** Neglected / overdue — needs Tend (watering). */
export function needsWatering(entry: VocabEntry, now = Date.now()): boolean {
  const count = entry.responseCount ?? 0;
  if (count <= 0) {
    return now - (entry.createdAt || now) > WATERING_NEVER_REVIEWED_DAYS * DAY_MS;
  }
  const dueAt = entry.nextReviewAt || 0;
  return now - dueAt > WATERING_OVERDUE_DAYS * DAY_MS;
}

/** One emoji set for now — replace with image paths later. */
export const STAGE_EMOJI: Record<GrowthStage, string> = {
  0: '🫘',
  1: '🌱',
  2: '🪴',
  3: '🌿',
  4: '🌳',
  5: '🌲',
};

export const WILTED_EMOJI = '🥀';

export function growthEmoji(stage: GrowthStage, wilted: boolean): string {
  return wilted ? WILTED_EMOJI : STAGE_EMOJI[stage];
}

/** Placeholder plant id for when you drop in image packs later. */
export function plantVariantFor(_entry: Pick<VocabEntry, 'hanzi'>): PlantVariant {
  return 'default';
}

/** @deprecated use plantVariantFor — kept so shelves/cards keep compiling during image swap */
export function plantIdFor(entry: Pick<VocabEntry, 'hanzi'>): PlantVariant {
  return plantVariantFor(entry);
}

export function topGrowthCohort(entries: VocabEntry[], thresholdMs: number): VocabEntry[] {
  if (entries.length === 0) return [];
  let best: GrowthStage = 0;
  const staged = entries.map((e) => ({ e, stage: growthStage(e, thresholdMs) }));
  for (const s of staged) best = Math.max(best, s.stage) as GrowthStage;
  return staged.filter((s) => s.stage === best).map((s) => s.e);
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickShelfSlice(pool: VocabEntry[], count: number, salt: number): VocabEntry[] {
  if (pool.length <= count) return pool;
  const ranked = [...pool].sort(
    (a, b) => hashString(a.hanzi + String(salt)) - hashString(b.hanzi + String(salt)),
  );
  return ranked.slice(0, count);
}
