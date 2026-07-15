import type { QuizLevel, QuizQuestion, VocabEntry } from '../types';
import { toPinyin } from './pinyin';
import {
  GROWTH_DEMO_HANZI,
  isGrowthDemoHanzi,
} from '../data/growthDemos';

export type MakerLevel = QuizLevel;

export type MakerSegment =
  | { kind: 'text'; value: string }
  | { kind: 'blank'; blankId: number };

export interface BlankSlot {
  id: number;
  answerHanzi: string;
  answerPinyin: string;
  answerEnglish: string;
}

export interface MakerExercise {
  sourceId?: number;
  english: string;
  fullHanzi: string;
  fullPinyin: string;
  level: MakerLevel;
  blanks: BlankSlot[];
  segments: MakerSegment[];
}

export interface MakerMcOption {
  id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  isCorrect: boolean;
}

export function quizQuestionUsesDemo(question: QuizQuestion): boolean {
  if ([...GROWTH_DEMO_HANZI].some((d) => question.hanzi.includes(d))) return true;
  if (/示范/.test(question.hanzi)) return true;
  return (question.sourceVocab ?? []).some((h) => isGrowthDemoHanzi(h));
}

function normalizeHanzi(hanzi: string): string {
  return hanzi.replace(/\s+/g, '').trim();
}

/** Strip punctuation so “我喝茶” and “我喝茶。” count as the same exercise. */
export function normalizeExerciseHanzi(hanzi: string): string {
  return normalizeHanzi(hanzi).replace(/[。！？!?.,，、；;：:""'‘’（）()【】\[\]\s]/g, '');
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Longest-match segmentation of a sentence against known vocab. */
export function segmentSentence(
  sentence: string,
  vocab: VocabEntry[],
): Array<{ start: number; end: number; text: string; entry: VocabEntry | null }> {
  const sorted = [...vocab]
    .filter((v) => v.hanzi.trim().length > 0)
    .sort((a, b) => b.hanzi.length - a.hanzi.length);

  const spans: Array<{ start: number; end: number; text: string; entry: VocabEntry | null }> = [];
  let i = 0;
  while (i < sentence.length) {
    let matched: VocabEntry | null = null;
    let len = 0;
    for (const v of sorted) {
      const h = v.hanzi;
      if (sentence.startsWith(h, i) && h.length > len) {
        matched = v;
        len = h.length;
      }
    }
    if (matched && len > 0) {
      spans.push({ start: i, end: i + len, text: matched.hanzi, entry: matched });
      i += len;
    } else {
      const ch = sentence[i];
      const last = spans[spans.length - 1];
      if (last && !last.entry && last.end === i) {
        last.text += ch;
        last.end = i + 1;
      } else {
        spans.push({ start: i, end: i + 1, text: ch, entry: null });
      }
      i += 1;
    }
  }
  return spans;
}

function blankCountForLevel(level: MakerLevel, available: number): number {
  // Level 1: fill a few missing words. Levels 2–3: type the full sentence (no blanks).
  if (level !== 1) return 0;
  if (available <= 0) return 0;
  if (available === 1) return 1;
  return Math.min(3, available);
}

function buildSegments(
  sentence: string,
  blankEntries: VocabEntry[],
): { segments: MakerSegment[]; blanks: BlankSlot[] } {
  const blankSet = new Set(blankEntries.map((e) => e.hanzi));
  const blanks: BlankSlot[] = blankEntries.map((e, idx) => ({
    id: idx,
    answerHanzi: e.hanzi,
    answerPinyin: e.pinyin,
    answerEnglish: e.english,
  }));
  const blankIdByHanzi = new Map(blankEntries.map((e, idx) => [e.hanzi, idx]));

  const segments: MakerSegment[] = [];
  let pos = 0;
  while (pos < sentence.length) {
    let hit: VocabEntry | null = null;
    for (const e of blankEntries) {
      if (sentence.startsWith(e.hanzi, pos)) {
        hit = e;
        break;
      }
    }
    if (hit && blankSet.has(hit.hanzi)) {
      segments.push({ kind: 'blank', blankId: blankIdByHanzi.get(hit.hanzi)! });
      pos += hit.hanzi.length;
      continue;
    }
    // literal text until next blank or end
    let end = pos + 1;
    while (end < sentence.length) {
      const nextBlank = blankEntries.find((e) => sentence.startsWith(e.hanzi, end));
      if (nextBlank) break;
      end += 1;
    }
    segments.push({ kind: 'text', value: sentence.slice(pos, end) });
    pos = end;
  }

  return { segments, blanks };
}

export function buildExerciseFromSentence(
  sentenceEntry: VocabEntry,
  vocab: VocabEntry[],
  level: MakerLevel,
): MakerExercise | null {
  const spans = segmentSentence(sentenceEntry.hanzi, vocab);
  const matched = spans.filter((s) => s.entry).map((s) => s.entry!);
  const unique = [...new Map(matched.map((e) => [e.hanzi, e])).values()];
  const need = blankCountForLevel(level, unique.length);
  if (level === 1 && need === 0) return null;

  const blankEntries =
    level === 1
      ? shuffle(unique)
          .slice(0, need)
          .sort((a, b) => {
            const ai = sentenceEntry.hanzi.indexOf(a.hanzi);
            const bi = sentenceEntry.hanzi.indexOf(b.hanzi);
            return ai - bi;
          })
      : [];

  const { segments, blanks } =
    level === 1
      ? buildSegments(sentenceEntry.hanzi, blankEntries)
      : { segments: [{ kind: 'text' as const, value: sentenceEntry.hanzi }], blanks: [] };

  return {
    sourceId: sentenceEntry.id,
    english: sentenceEntry.english,
    fullHanzi: sentenceEntry.hanzi,
    fullPinyin: sentenceEntry.pinyin || toPinyin(sentenceEntry.hanzi),
    level,
    blanks,
    segments,
  };
}

export function pickUserSentences(entries: VocabEntry[]): VocabEntry[] {
  return shuffle(entries.filter((e) => e.type === 'sentence' && e.hanzi.trim().length > 0));
}

export function pickSentenceTemplates(
  entries: VocabEntry[],
  vocab: VocabEntry[],
): VocabEntry[] {
  const sentences = entries.filter((e) => e.type === 'sentence');
  const longPhrases = entries.filter(
    (e) => e.type === 'phrase' && e.hanzi.replace(/\s+/g, '').length >= 4,
  );
  const pool = [...sentences, ...longPhrases];
  return shuffle(
    pool.filter((s) => {
      const matched = segmentSentence(s.hanzi, vocab).filter((sp) => sp.entry);
      return matched.length >= 1;
    }),
  );
}

export function buildMcForBlank(
  blank: BlankSlot,
  vocab: VocabEntry[],
  count = 4,
): MakerMcOption[] {
  const correct: MakerMcOption = {
    id: `c-${blank.answerHanzi}`,
    hanzi: blank.answerHanzi,
    pinyin: blank.answerPinyin,
    english: blank.answerEnglish,
    isCorrect: true,
  };
  const distractors = shuffle(
    vocab.filter(
      (v) =>
        v.type === 'word' &&
        normalizeHanzi(v.hanzi) !== normalizeHanzi(blank.answerHanzi),
    ),
  )
    .slice(0, count - 1)
    .map((v) => ({
      id: `d-${v.id ?? v.hanzi}`,
      hanzi: v.hanzi,
      pinyin: v.pinyin,
      english: v.english,
      isCorrect: false,
    }));

  return shuffle([correct, ...distractors].slice(0, count));
}

export function buildWordBank(
  blanks: BlankSlot[],
  vocab: VocabEntry[],
  extra = 4,
): MakerMcOption[] {
  const answers = blanks.map((b) => ({
    id: `a-${b.id}`,
    hanzi: b.answerHanzi,
    pinyin: b.answerPinyin,
    english: b.answerEnglish,
    isCorrect: true,
  }));
  const answerSet = new Set(blanks.map((b) => normalizeHanzi(b.answerHanzi)));
  const filler = shuffle(
    vocab.filter(
      (v) => v.type === 'word' && !answerSet.has(normalizeHanzi(v.hanzi)),
    ),
  )
    .slice(0, extra)
    .map((v) => ({
      id: `f-${v.id ?? v.hanzi}`,
      hanzi: v.hanzi,
      pinyin: v.pinyin,
      english: v.english,
      isCorrect: false,
    }));
  return shuffle([...answers, ...filler]);
}

export function checkFullSentence(userInput: string, expected: string): boolean {
  return normalizeHanzi(userInput) === normalizeHanzi(expected);
}

export function checkBlanksFilled(
  blanks: BlankSlot[],
  answers: Record<number, string>,
): boolean {
  return blanks.every(
    (b) => normalizeHanzi(answers[b.id] ?? '') === normalizeHanzi(b.answerHanzi),
  );
}

export interface MakerGeminiExercise {
  english: string;
  hanzi: string;
  blankHanzi: string[];
}

export function pickQuizQuestion(
  questions: QuizQuestion[],
  level: MakerLevel,
  usedIds: Set<number>,
  usedHanzi?: Set<string>,
): QuizQuestion | null {
  const available = questions.filter((q) => {
    if (q.level !== level || q.id == null || usedIds.has(q.id)) return false;
    if (quizQuestionUsesDemo(q)) return false;
    if (usedHanzi?.has(normalizeExerciseHanzi(q.hanzi))) return false;
    return true;
  });
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

export function buildExerciseFromQuizQuestion(
  question: QuizQuestion,
  vocab: VocabEntry[],
  level: MakerLevel,
): MakerExercise | null {
  const ex = exerciseFromGemini(
    {
      english: question.english,
      hanzi: question.hanzi,
      blankHanzi: question.blankHanzi,
    },
    vocab,
    level,
  );
  if (!ex) return null;
  return { ...ex, sourceId: question.id };
}

export function exerciseFromGemini(
  data: MakerGeminiExercise,
  vocab: VocabEntry[],
  level: MakerLevel,
): MakerExercise | null {
  const hanzi = data.hanzi.trim();
  const english = data.english.trim();
  if (!hanzi || !english) return null;

  const vocabByHanzi = new Map(vocab.map((v) => [v.hanzi, v]));
  const requested = data.blankHanzi
    .map((h) => vocabByHanzi.get(h.trim()))
    .filter((e): e is VocabEntry => Boolean(e));

  const spans = segmentSentence(hanzi, vocab);
  const matched = spans.filter((s) => s.entry).map((s) => s.entry!);
  const unique = [...new Map(matched.map((e) => [e.hanzi, e])).values()];

  let blankEntries: VocabEntry[] = [];
  if (level === 1) {
    if (requested.length > 0) {
      blankEntries = requested.slice(0, Math.min(3, Math.max(requested.length, 1)));
    } else if (unique.length > 0) {
      const n = unique.length === 1 ? 1 : Math.min(3, unique.length);
      blankEntries = unique.slice(0, n);
    }
  }

  const { segments, blanks } =
    level === 1
      ? buildSegments(hanzi, blankEntries)
      : { segments: [{ kind: 'text' as const, value: hanzi }], blanks: [] };

  if (level === 1 && blanks.length === 0) return null;

  return {
    english,
    fullHanzi: hanzi,
    fullPinyin: toPinyin(hanzi),
    level,
    blanks,
    segments,
  };
}
