import type { VocabEntry } from '../types';
import { db, DEFAULT_TIMER_MS } from '../db/schema';
import { isGrowthDemoEntry } from '../data/growthDemos';
import {
  formatToneChoice,
  formatTonePattern,
  thirdToneSandhi,
  toneDistractors,
  tonesFromPinyin,
} from './pinyin';

const MIN_TIMER_MS = 3000;
const MAX_TIMER_MS = 12000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CHOICE_COUNT = 4;

export type CardMode =
  | 'hanzi-to-english'
  | 'english-to-hanzi'
  | 'pinyin-to-hanzi'
  | 'hanzi-to-tone'
  | 'measure-words';

export function isMeasureWordMode(mode: CardMode): boolean {
  return mode === 'measure-words';
}

export function isToneMode(mode: CardMode): boolean {
  return mode === 'hanzi-to-tone';
}

/** Underlying drill used for measure-word sessions (English → Hanzi). */
export function drillModeFor(mode: CardMode): CardMode {
  if (mode === 'measure-words') return 'english-to-hanzi';
  return mode;
}

export function filterEntriesForMode(entries: VocabEntry[], mode: CardMode): VocabEntry[] {
  const base = entries.filter((e) => e.type !== 'sentence' && !isGrowthDemoEntry(e));
  if (mode === 'measure-words') {
    return base.filter((e) => e.topics.includes('Measure Words'));
  }
  if (mode === 'hanzi-to-tone') {
    // Prefer words/phrases with readable pinyin (skip empty / non-hanzi noise).
    return base.filter((e) => e.type === 'word' && tonesFromPinyin(e.pinyin).length > 0);
  }
  return base;
}

export type ReviewOutcome = 'correct' | 'wrong' | 'timeout';

export type McOption = {
  id: string;
  primary: string;
  secondary?: string;
  isCorrect: boolean;
};

export function nextTimerMs(current: number, outcome: ReviewOutcome): number {
  if (outcome === 'correct') {
    return Math.max(MIN_TIMER_MS, Math.round(current * 0.85));
  }
  return Math.min(MAX_TIMER_MS, Math.round(current * 1.25));
}

export function applyReview(
  entry: VocabEntry,
  outcome: ReviewOutcome,
  responseMs?: number,
): Partial<VocabEntry> {
  const now = Date.now();
  const timerMs = nextTimerMs(entry.timerMs || DEFAULT_TIMER_MS, outcome);
  let ease = entry.ease || 2.5;
  let interval = entry.interval || 0;
  let status = entry.status;

  if (outcome === 'correct') {
    ease = Math.min(3.0, ease + 0.05);
    interval = interval === 0 ? 1 : Math.round(interval * ease);
    if (interval >= 3) status = 'learned';
  } else {
    ease = Math.max(1.3, ease - 0.2);
    interval = 0;
    status = 'learning';
  }

  const elapsed = Math.max(0, responseMs ?? timerMs);
  const prevTotal = entry.totalResponseMs ?? 0;
  const prevCount = entry.responseCount ?? 0;

  return {
    timerMs,
    ease,
    interval,
    status,
    lastResult: outcome,
    nextReviewAt: now + Math.max(interval, 0.05) * DAY_MS,
    updatedAt: now,
    correctCount: (entry.correctCount || 0) + (outcome === 'correct' ? 1 : 0),
    wrongCount: (entry.wrongCount || 0) + (outcome === 'correct' ? 0 : 1),
    totalResponseMs: prevTotal + elapsed,
    responseCount: prevCount + 1,
  };
}

/** Hydrate a card without scoring a flashcard review (e.g. used in Forms). */
export function waterPatch(entry: VocabEntry, now = Date.now()): Partial<VocabEntry> {
  const hydrateUntil = now + 2 * DAY_MS;
  return {
    nextReviewAt: Math.max(entry.nextReviewAt || 0, hydrateUntil),
    updatedAt: now,
  };
}

/** Bump nextReviewAt for vocab used in Forms (clears wilt without flashcard stats). */
export async function waterVocabEntries(entries: VocabEntry[]): Promise<void> {
  const now = Date.now();
  await Promise.all(
    entries
      .filter((e) => e.id != null && e.type !== 'sentence')
      .map((e) => db.entries.update(e.id!, waterPatch(e, now))),
  );
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Due count for display — not session order. */
export function countDueEntries(entries: VocabEntry[], mode: CardMode = 'hanzi-to-english'): number {
  const now = Date.now();
  return filterEntriesForMode(entries, mode).filter((e) => (e.nextReviewAt || 0) <= now).length;
}

/** Randomised session queue: due cards shuffled, topped up with random others, then shuffled again. */
export function buildSessionQueue(
  entries: VocabEntry[],
  limit = 25,
  mode: CardMode = 'hanzi-to-english',
): VocabEntry[] {
  const now = Date.now();
  const eligible = filterEntriesForMode(entries, mode);
  const due = eligible.filter((e) => (e.nextReviewAt || 0) <= now);
  const other = eligible.filter((e) => (e.nextReviewAt || 0) > now);

  const queue: VocabEntry[] = [...shuffle(due)];
  if (queue.length < limit) {
    queue.push(...shuffle(other).slice(0, limit - queue.length));
  }
  if (queue.length > limit) {
    return shuffle(queue.slice(0, limit));
  }
  return shuffle(queue);
}

/** @deprecated use countDueEntries or buildSessionQueue */
export function pickDueEntries(entries: VocabEntry[], limit = 20): VocabEntry[] {
  return buildSessionQueue(entries, limit);
}

export function avgResponseMs(entry: VocabEntry): number | null {
  const count = entry.responseCount ?? 0;
  if (count <= 0) return null;
  return Math.round((entry.totalResponseMs ?? 0) / count);
}

const DEFAULT_LEARNED_THRESHOLD_MS = 4000;
const MIN_LEARNED_REVIEWS = 3;

/**
 * Performance-based "learned": enough reviews, non-losing correct ratio,
 * and average response time at or under the threshold (from Settings).
 */
export function isPerformanceLearned(
  entry: VocabEntry,
  thresholdMs = DEFAULT_LEARNED_THRESHOLD_MS,
  minReviews = MIN_LEARNED_REVIEWS,
): boolean {
  const avg = avgResponseMs(entry);
  const count = entry.responseCount ?? 0;
  const right = entry.correctCount ?? 0;
  const wrong = entry.wrongCount ?? 0;
  if (avg == null || count < minReviews) return false;
  return avg <= thresholdMs && right >= wrong;
}

/** @deprecated prefer isPerformanceLearned with settings threshold */
export function isFastRecall(entry: VocabEntry, thresholdMs = DEFAULT_LEARNED_THRESHOLD_MS): boolean {
  return isPerformanceLearned(entry, thresholdMs);
}

export function promptFor(entry: VocabEntry, mode: CardMode): string {
  const drill = drillModeFor(mode);
  if (drill === 'hanzi-to-english' || drill === 'hanzi-to-tone') return entry.hanzi;
  if (drill === 'english-to-hanzi') return entry.english;
  return entry.pinyin;
}

export function promptSubtext(entry: VocabEntry, mode: CardMode): string | undefined {
  const drill = drillModeFor(mode);
  if (drill === 'hanzi-to-english') return entry.pinyin;
  if (drill === 'hanzi-to-tone') return undefined; // hide tones — that's the quiz
  if (mode === 'measure-words') return 'Pick the measure word';
  return undefined;
}

export function answerFor(entry: VocabEntry, mode: CardMode): { primary: string; secondary?: string } {
  const drill = drillModeFor(mode);
  if (drill === 'hanzi-to-english') return { primary: entry.english };
  if (drill === 'hanzi-to-tone') {
    const tones = tonesFromPinyin(entry.pinyin);
    const choice = formatToneChoice(tones);
    return { primary: choice.primary, secondary: entry.pinyin };
  }
  if (drill === 'english-to-hanzi') return { primary: entry.hanzi, secondary: entry.pinyin };
  return { primary: entry.hanzi, secondary: entry.pinyin };
}

export function sandhiNoteFor(entry: VocabEntry): string | null {
  const tones = tonesFromPinyin(entry.pinyin);
  return thirdToneSandhi(tones).note;
}

function optionKey(entry: VocabEntry, mode: CardMode): string {
  const drill = drillModeFor(mode);
  if (drill === 'hanzi-to-english') return entry.english.toLowerCase().trim();
  if (drill === 'hanzi-to-tone') return formatTonePattern(tonesFromPinyin(entry.pinyin));
  return entry.hanzi.replace(/\s+/g, '');
}

function answerSurface(entry: VocabEntry, mode: CardMode): string {
  const drill = drillModeFor(mode);
  if (drill === 'hanzi-to-english') return entry.english.trim();
  if (drill === 'hanzi-to-tone') return formatTonePattern(tonesFromPinyin(entry.pinyin));
  return entry.hanzi.replace(/\s+/g, '');
}

function englishWordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Higher = better distractor (similar shape to the correct answer). */
function distractorScore(candidate: VocabEntry, current: VocabEntry, mode: CardMode): number {
  let score = 0;
  const drill = drillModeFor(mode);

  if (candidate.type === current.type) score += 55;
  else if (current.type === 'phrase' && candidate.type === 'word') score -= 35;
  else if (current.type === 'word' && candidate.type === 'phrase') score -= 20;

  const a = answerSurface(current, mode);
  const b = answerSurface(candidate, mode);
  const lenA = Math.max(1, a.length);
  const lenB = Math.max(1, b.length);
  const lenRatio = Math.min(lenA, lenB) / Math.max(lenA, lenB);
  score += lenRatio * 45;

  if (drill === 'hanzi-to-english') {
    const wA = englishWordCount(a);
    const wB = englishWordCount(b);
    score -= Math.abs(wA - wB) * 18;
    // “what's going on” shouldn't sit next to “cat”
    if (wA >= 3 && wB <= 1) score -= 55;
    if (wA >= 4 && wB <= 2) score -= 30;
    if (wA === 1 && wB >= 4) score -= 35;
  } else {
    if (lenA >= 3 && lenB === 1) score -= 50;
    if (lenA >= 4 && lenB <= 2) score -= 25;
    if (lenA === 1 && lenB >= 4) score -= 35;
  }

  if (candidate.topics.some((t) => current.topics.includes(t))) score += 12;
  if (mode === 'measure-words' && candidate.topics.includes('Measure Words')) score += 40;

  return score;
}

function pickDistractors(
  current: VocabEntry,
  pool: VocabEntry[],
  mode: CardMode,
  need: number,
): VocabEntry[] {
  if (need <= 0) return [];

  const correctKey = optionKey(current, mode);
  const distractorPool = pool.filter((e) => {
    if (e.id === current.id) return false;
    if (e.type === 'sentence') return false;
    if (isGrowthDemoEntry(e)) return false;
    return optionKey(e, mode) !== correctKey;
  });

  if (distractorPool.length === 0) return [];

  const sameType = distractorPool.filter((e) => e.type === current.type);
  const candidates = sameType.length >= need ? sameType : distractorPool;

  const ranked = candidates
    .map((e) => ({ e, score: distractorScore(e, current, mode) }))
    .sort((a, b) => b.score - a.score || Math.random() - 0.5);

  // Soft pick from the best-matching band so sessions stay varied.
  const band = ranked.slice(0, Math.max(need * 4, Math.min(ranked.length, 14)));
  const picked = shuffle(band.map((x) => x.e)).slice(0, need);

  if (picked.length >= need) return picked;

  // Top up from remaining pool if the band was thin.
  const used = new Set(picked.map((e) => e.id ?? e.hanzi));
  const rest = shuffle(distractorPool.filter((e) => !used.has(e.id ?? e.hanzi)));
  return [...picked, ...rest].slice(0, need);
}

function entryToOption(entry: VocabEntry, mode: CardMode, isCorrect: boolean): McOption {
  const drill = drillModeFor(mode);
  if (drill === 'hanzi-to-english') {
    return {
      id: String(entry.id ?? entry.hanzi),
      primary: entry.english,
      isCorrect,
    };
  }
  if (drill === 'hanzi-to-tone') {
    const tones = tonesFromPinyin(entry.pinyin);
    const choice = formatToneChoice(tones);
    return {
      id: `tone-${formatTonePattern(tones)}`,
      primary: choice.primary,
      secondary: choice.secondary,
      isCorrect,
    };
  }
  return {
    id: String(entry.id ?? entry.hanzi),
    primary: entry.hanzi,
    secondary: entry.pinyin,
    isCorrect,
  };
}

function buildToneChoices(current: VocabEntry, count = CHOICE_COUNT): McOption[] {
  const correct = tonesFromPinyin(current.pinyin);
  if (correct.length === 0) {
    return [{ id: 'tone-none', primary: '—', isCorrect: true }];
  }
  const choice = formatToneChoice(correct);
  const options: McOption[] = [
    {
      id: `tone-${formatTonePattern(correct)}`,
      primary: choice.primary,
      secondary: choice.secondary,
      isCorrect: true,
    },
  ];
  for (const wrong of toneDistractors(correct, Math.max(0, count - 1))) {
    const c = formatToneChoice(wrong);
    options.push({
      id: `tone-${formatTonePattern(wrong)}`,
      primary: c.primary,
      secondary: c.secondary,
      isCorrect: false,
    });
  }
  return shuffle(options.slice(0, count));
}

export function buildMultipleChoice(
  current: VocabEntry,
  pool: VocabEntry[],
  mode: CardMode,
  count = CHOICE_COUNT,
): McOption[] {
  if (mode === 'hanzi-to-tone') {
    return buildToneChoices(current, count);
  }

  const distractorPool =
    mode === 'measure-words' ? filterEntriesForMode(pool, 'measure-words') : pool;
  const distractors = pickDistractors(current, distractorPool, mode, Math.max(0, count - 1));
  const options = [
    entryToOption(current, mode, true),
    ...distractors.map((e) => entryToOption(e, mode, false)),
  ];

  return shuffle(options.slice(0, count));
}

export function formatAvgResponse(entry: VocabEntry): string | null {
  const avg = avgResponseMs(entry);
  if (avg == null) return null;
  return `${formatSecondsSigFig(avg / 1000)}s avg`;
}

export { MIN_TIMER_MS, MAX_TIMER_MS, CHOICE_COUNT };

/** Format seconds for display with one significant figure (e.g. 7.3 → 7, 0.8 → 0.8). */
export function formatSecondsSigFig(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0';
  const magnitude = Math.floor(Math.log10(seconds));
  const factor = 10 ** (1 - 1 - magnitude);
  const rounded = Math.round(seconds * factor) / factor;
  if (rounded >= 10) return String(Math.round(rounded));
  if (rounded >= 1) return String(Math.round(rounded));
  return String(rounded);
}
