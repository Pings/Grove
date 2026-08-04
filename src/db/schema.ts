import Dexie, { type EntityTable } from 'dexie';
import type { QuizQuestion, VocabEntry } from '../types';
import { MEASURE_WORD_HANZI } from '../types';
import { SEED_ENTRIES } from '../data/seed';
import { isGrowthDemoEntry, isGrowthDemoHanzi } from '../data/growthDemos';
import { SEED_GRAMMAR_TIPS, SEED_HANZI_TIPS, TIPS_CONTENT_VERSION } from '../data/seedTips';
import { toPinyin } from '../lib/pinyin';
import { getStorageMode } from '../lib/settings';

const DEFAULT_TIMER_MS = 8000;
const TIPS_VERSION_KEY = 'chineseLearning.tipsContentVersion';

export class ChineseDB extends Dexie {
  entries!: EntityTable<VocabEntry, 'id'>;
  quizQuestions!: EntityTable<QuizQuestion, 'id'>;

  constructor() {
    super('chineseLearningApp');
    this.version(1).stores({
      entries: '++id, hanzi, english, type, hsk, status, nextReviewAt, *topics',
    });
    this.version(2).stores({
      entries: '++id, hanzi, english, type, hsk, status, nextReviewAt, *topics',
      quizQuestions: '++id, level, batchId, createdAt',
    });
  }
}

export const db = new ChineseDB();

function armSyncHooks() {
  const kick = () => {
    void import('../lib/sync').then((m) => m.scheduleSyncPush());
  };
  db.entries.hook('creating', kick);
  db.entries.hook('updating', kick);
  db.entries.hook('deleting', kick);
  db.quizQuestions.hook('creating', kick);
  db.quizQuestions.hook('updating', kick);
  db.quizQuestions.hook('deleting', kick);
}
armSyncHooks();

function normalizeHanzi(hanzi: string): string {
  return hanzi.replace(/\s+/g, '');
}

export function defaultExtraDetail(hanzi: string, _english?: string, _type?: string, _topics?: string[]): string {
  return SEED_GRAMMAR_TIPS[hanzi] ?? '';
}

export function defaultHanziDetail(hanzi: string, _english?: string): string {
  return SEED_HANZI_TIPS[hanzi] ?? '';
}

/** Strip restated glosses like 「明天」(“tomorrow”) from older tips. */
export function scrubSelfReference(text: string, hanzi: string, english: string): string {
  if (!text.trim()) return '';
  let out = text.trim();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const h = esc(hanzi);
  const e = esc(english);
  out = out.replace(new RegExp(`「${h}」\\s*[（(]?\\s*[“"']?${e}[”"']?\\s*[）)]?\\s*[—–\\-]?\\s*`, 'i'), '');
  out = out.replace(new RegExp(`「${h}」\\s*`, 'g'), '');
  out = out.replace(new RegExp(`\\(?\\s*[“"']?${e}[”"']?\\s*\\)?\\s*[—–\\-]?\\s*`, 'i'), (m, offset) =>
    offset < 8 ? '' : m,
  );
  out = out.replace(/^means\s+[“"'][^”"']+[”"']\s*;?\s*/i, '');
  out = out.replace(/^is a set phrase meaning\s+[“"'][^”"']+[”"']\s*;?\s*/i, '');
  out = out.replace(/^is a building-block character for\s+[“"'][^”"']+[”"']\s*[—–\\-]?\s*/i, '');
  return out.replace(/\s{2,}/g, ' ').trim();
}

function tipsFor(hanzi: string, english: string, type: string, topics: string[]) {
  return {
    extraDetail: defaultExtraDetail(hanzi, english, type, topics),
    // Sentences: grammar tip only — character tips don’t apply.
    hanziDetail: type === 'sentence' ? '' : defaultHanziDetail(hanzi, english),
  };
}

function makeEntry(
  seed: (typeof SEED_ENTRIES)[number],
  now: number,
): Omit<VocabEntry, 'id'> {
  const tips = tipsFor(seed.hanzi, seed.english, seed.type, seed.topics);
  // Seed author notes → grammar only when they’re usage tips, not radical notes
  const note = seed.notes?.trim() ?? '';
  const looksLikeRadicalNote = /radical|component|口|木|女|犭|讠/i.test(note);
  const grammar =
    tips.extraDetail ||
    (!looksLikeRadicalNote && note && note.length < 70 && !/[「]/.test(note)
      ? note.replace(/\.$/, '') + '.'
      : '');

  return {
    hanzi: seed.hanzi,
    pinyin: seed.pinyin?.trim() || toPinyin(seed.hanzi),
    english: seed.english,
    type: seed.type,
    topics: seed.topics,
    hsk: seed.hsk,
    notes: '',
    extraDetail: grammar,
    extraDetailRating: 0,
    rejectedDetails: [],
    hanziDetail: tips.hanziDetail,
    hanziDetailRating: 0,
    rejectedHanziDetails: [],
    status: seed.status ?? 'learning',
    ease: 2.5,
    interval: 0,
    nextReviewAt: now,
    lastResult: null,
    timerMs: DEFAULT_TIMER_MS,
    correctCount: 0,
    wrongCount: 0,
    totalResponseMs: 0,
    responseCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** Remove duplicate hanzi rows (keeps lowest id). */
export async function dedupeEntries(): Promise<number> {
  const all = await db.entries.toArray();
  const seen = new Map<string, number>();
  const toDelete: number[] = [];

  for (const entry of all) {
    if (entry.id == null) continue;
    const key = normalizeHanzi(entry.hanzi);
    const existingId = seen.get(key);
    if (existingId == null) {
      seen.set(key, entry.id);
      continue;
    }
    toDelete.push(entry.id);
  }

  if (toDelete.length > 0) {
    await db.entries.bulkDelete(toDelete);
  }
  return toDelete.length;
}

/** Fill new fields + scrub old self-referencing tips. */
export async function migrateEntryFields(): Promise<void> {
  const all = await db.entries.toArray();
  const seedByHanzi = new Map(
    SEED_ENTRIES.map((s) => [normalizeHanzi(s.hanzi), s] as const),
  );
  const now = Date.now();
  const storedTipsVersion = Number(localStorage.getItem(TIPS_VERSION_KEY) || '0');
  const refreshTips = storedTipsVersion < TIPS_CONTENT_VERSION;

  await Promise.all(
    all.map(async (entry) => {
      if (entry.id == null) return;
      const patch: Partial<VocabEntry> = { updatedAt: now };
      let changed = false;

      if (entry.correctCount == null) {
        patch.correctCount = 0;
        changed = true;
      }
      if (entry.wrongCount == null) {
        patch.wrongCount = 0;
        changed = true;
      }
      if (entry.totalResponseMs == null) {
        patch.totalResponseMs = 0;
        changed = true;
      }
      if (entry.responseCount == null) {
        patch.responseCount = 0;
        changed = true;
      }
      if (entry.extraDetailRating == null) {
        patch.extraDetailRating = 0;
        changed = true;
      }
      if (!Array.isArray(entry.rejectedDetails)) {
        patch.rejectedDetails = [];
        changed = true;
      }
      if (entry.hanziDetailRating == null) {
        patch.hanziDetailRating = 0;
        changed = true;
      }
      if (!Array.isArray(entry.rejectedHanziDetails)) {
        patch.rejectedHanziDetails = [];
        changed = true;
      }

      const seed = seedByHanzi.get(normalizeHanzi(entry.hanzi));
      const freshGrammar = defaultExtraDetail(
        entry.hanzi,
        entry.english,
        entry.type,
        entry.topics,
      );
      const freshHanzi =
        entry.type === 'sentence' ? '' : defaultHanziDetail(entry.hanzi, entry.english);
      const seedNote = seed?.notes?.trim() ?? '';
      const looksLikeRadicalNote = /radical|component|口|木|女|犭|讠/i.test(seedNote);
      const preferredGrammar =
        freshGrammar ||
        (!looksLikeRadicalNote && seedNote && seedNote.length < 70 && !/[「]/.test(seedNote)
          ? seedNote.replace(/\.$/, '') + '.'
          : '');

      // Never replace upvoted tips — not even on tip-content refreshes.
      const keepGrammar = entry.extraDetailRating === 1 && Boolean(entry.extraDetail?.trim());
      const keepHanzi =
        entry.type !== 'sentence' &&
        entry.hanziDetailRating === 1 &&
        Boolean(entry.hanziDetail?.trim());

      let extra = keepGrammar
        ? entry.extraDetail!
        : refreshTips || !entry.extraDetail?.trim()
          ? preferredGrammar
          : entry.extraDetail;

      let hanziDetail =
        entry.type === 'sentence'
          ? ''
          : keepHanzi
            ? entry.hanziDetail!
            : refreshTips || !entry.hanziDetail?.trim()
              ? freshHanzi
              : entry.hanziDetail;

      if (seed?.notes && entry.notes?.trim() === seed.notes.trim()) {
        patch.notes = '';
        changed = true;
      }

      // Retag classic measure words into the Measure Words topic.
      const key = normalizeHanzi(entry.hanzi);
      if ((MEASURE_WORD_HANZI as readonly string[]).includes(key)) {
        const nextTopics = [
          'Measure Words',
          ...entry.topics.filter((t) => t !== 'Measure Words' && t !== 'Grammar'),
        ];
        if (
          nextTopics.length !== entry.topics.length ||
          nextTopics.some((t, i) => t !== entry.topics[i])
        ) {
          patch.topics = nextTopics;
          changed = true;
        }
      }

      // Skip scrubbing for kept (upvoted) tips so we never erase them.
      if (!keepGrammar) {
        const scrubbedExtra = scrubSelfReference(extra, entry.hanzi, entry.english);
        if (scrubbedExtra !== extra) {
          extra = scrubbedExtra || preferredGrammar;
          changed = true;
        }
      }
      if (!keepHanzi && entry.type !== 'sentence') {
        const scrubbedHanzi = scrubSelfReference(hanziDetail, entry.hanzi, entry.english);
        if (scrubbedHanzi !== hanziDetail) {
          hanziDetail = scrubbedHanzi || freshHanzi;
          changed = true;
        }
      }

      if (extra !== entry.extraDetail) {
        if (!(entry.extraDetailRating === 1 && entry.extraDetail?.trim())) {
          patch.extraDetail = extra;
          if (refreshTips) patch.extraDetailRating = 0;
          changed = true;
        }
      }
      if (hanziDetail !== entry.hanziDetail) {
        if (!(entry.hanziDetailRating === 1 && entry.hanziDetail?.trim())) {
          patch.hanziDetail = hanziDetail;
          if (refreshTips) patch.hanziDetailRating = 0;
          changed = true;
        }
      }

      if (changed) await db.entries.update(entry.id, patch);
    }),
  );

  if (refreshTips) {
    localStorage.setItem(TIPS_VERSION_KEY, String(TIPS_CONTENT_VERSION));
  }
}

let seedPromise: Promise<void> | null = null;

export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      await dedupeEntries();

      const count = await db.entries.count();
      // Don't auto-seed when sync/profiles are on — empty profile must stay empty.
      if (count === 0 && getStorageMode() !== 'sync') {
        const now = Date.now();
        const seen = new Set<string>();
        const rows: Omit<VocabEntry, 'id'>[] = [];

        for (const seed of SEED_ENTRIES) {
          const key = normalizeHanzi(seed.hanzi);
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(makeEntry(seed, now));
        }

        await db.entries.bulkAdd(rows);
      }

      await migrateEntryFields();
      await removeGrowthDemos();
    })();
  }
  return seedPromise;
}

/** Wipe library + quiz bank (used when switching sync profiles). */
export async function clearLibraryData(): Promise<void> {
  await db.transaction('rw', db.entries, db.quizQuestions, async () => {
    await db.entries.clear();
    await db.quizQuestions.clear();
  });
}

/** One-shot cleanup: remove old shelf growth-demo cards (示范…). */
export async function removeGrowthDemos(): Promise<void> {
  const all = await db.entries.toArray();
  const ids = all.filter((e) => isGrowthDemoEntry(e) && e.id != null).map((e) => e.id!);
  if (ids.length > 0) await db.entries.bulkDelete(ids);
}

export async function findByHanzi(hanzi: string): Promise<VocabEntry | undefined> {
  const normalized = normalizeHanzi(hanzi);
  const all = await db.entries.toArray();
  return all.find((e) => normalizeHanzi(e.hanzi) === normalized);
}

export async function upsertEntry(
  partial: Omit<
    VocabEntry,
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'ease'
    | 'interval'
    | 'nextReviewAt'
    | 'lastResult'
    | 'timerMs'
    | 'extraDetail'
    | 'extraDetailRating'
    | 'rejectedDetails'
    | 'hanziDetail'
    | 'hanziDetailRating'
    | 'rejectedHanziDetails'
    | 'correctCount'
    | 'wrongCount'
    | 'totalResponseMs'
    | 'responseCount'
  > &
    Partial<
      Pick<
        VocabEntry,
        | 'ease'
        | 'interval'
        | 'nextReviewAt'
        | 'lastResult'
        | 'timerMs'
        | 'extraDetail'
        | 'extraDetailRating'
        | 'rejectedDetails'
        | 'hanziDetail'
        | 'hanziDetailRating'
        | 'rejectedHanziDetails'
        | 'correctCount'
        | 'wrongCount'
        | 'totalResponseMs'
        | 'responseCount'
      >
    >,
): Promise<number> {
  const existing = await findByHanzi(partial.hanzi);
  const now = Date.now();
  if (existing?.id != null) {
    await db.entries.update(existing.id, {
      ...partial,
      pinyin: partial.pinyin || toPinyin(partial.hanzi),
      updatedAt: now,
    });
    return existing.id;
  }
  const id = await db.entries.add({
    ease: 2.5,
    interval: 0,
    nextReviewAt: now,
    lastResult: null,
    timerMs: DEFAULT_TIMER_MS,
    extraDetail:
      scrubSelfReference(
        partial.extraDetail?.trim() ||
          defaultExtraDetail(partial.hanzi, partial.english, partial.type, partial.topics),
        partial.hanzi,
        partial.english,
      ) || defaultExtraDetail(partial.hanzi, partial.english, partial.type, partial.topics),
    extraDetailRating: 0,
    rejectedDetails: [],
    hanziDetail:
      partial.type === 'sentence'
        ? ''
        : partial.hanziDetail?.trim() || defaultHanziDetail(partial.hanzi, partial.english),
    hanziDetailRating: 0,
    rejectedHanziDetails: [],
    correctCount: 0,
    wrongCount: 0,
    totalResponseMs: 0,
    responseCount: 0,
    ...partial,
    pinyin: partial.pinyin || toPinyin(partial.hanzi),
    createdAt: now,
    updatedAt: now,
  });
  return id as number;
}

export async function exportEntries(): Promise<VocabEntry[]> {
  return db.entries.toArray();
}

export async function getAllEntries(): Promise<VocabEntry[]> {
  return db.entries.toArray();
}

export async function importEntries(entries: VocabEntry[]): Promise<number> {
  let imported = 0;
  for (const entry of entries) {
    const { id: _id, ...rest } = entry;
    await upsertEntry({
      ...rest,
      pinyin: rest.pinyin || toPinyin(rest.hanzi),
    });
    imported += 1;
  }
  return imported;
}

export async function resetTimers(): Promise<void> {
  const all = await db.entries.toArray();
  const now = Date.now();
  await Promise.all(
    all.map((e) =>
      e.id != null
        ? db.entries.update(e.id, {
            timerMs: DEFAULT_TIMER_MS,
            ease: 2.5,
            interval: 0,
            nextReviewAt: now,
            lastResult: null,
            updatedAt: now,
          })
        : Promise.resolve(),
    ),
  );
}

export { DEFAULT_TIMER_MS, normalizeHanzi };

export async function getQuizQuestions() {
  return db.quizQuestions.toArray();
}

export async function replaceQuizQuestions(
  rows: Omit<QuizQuestion, 'id'>[],
): Promise<void> {
  await db.quizQuestions.clear();
  if (rows.length > 0) {
    await db.quizQuestions.bulkAdd(rows);
  }
}

export async function countWordsPhrasesSince(since: number): Promise<number> {
  const all = await db.entries.toArray();
  return all.filter(
    (e) =>
      (e.type === 'word' || e.type === 'phrase') &&
      !isGrowthDemoHanzi(e.hanzi) &&
      (e.createdAt ?? 0) > since,
  ).length;
}

/** Queue new words/phrases for flashcard review after refresh. */
export async function queueNewEntriesForFlashcards(since: number): Promise<number> {
  const now = Date.now();
  const all = await db.entries.toArray();
  let queued = 0;
  await Promise.all(
    all.map(async (e) => {
      if (e.id == null) return;
      if (e.type === 'sentence') return;
      if (isGrowthDemoHanzi(e.hanzi)) return;
      if ((e.createdAt ?? 0) <= since) return;
      await db.entries.update(e.id, { nextReviewAt: now, updatedAt: now });
      queued += 1;
    }),
  );
  return queued;
}
