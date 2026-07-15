import {
  getAllEntries,
  queueNewEntriesForFlashcards,
  replaceQuizQuestions,
} from '../db/schema';
import type { HskLevel, QuizRefreshResult, VocabEntry } from '../types';
import { isGrowthDemoEntry } from '../data/growthDemos';
import { regenerateQuizBank } from './gemini';
import { getLearnedAvgMs, getQuizRefreshMeta, setQuizRefreshMeta } from './settings';
import { isPerformanceLearned } from './flashcards';

function realWordPhrases(entries: VocabEntry[]): VocabEntry[] {
  return entries.filter(
    (e) => (e.type === 'word' || e.type === 'phrase') && !isGrowthDemoEntry(e),
  );
}

function countWordPhrases(entries: VocabEntry[]): number {
  return realWordPhrases(entries).length;
}

function analyseHskLevel(entries: VocabEntry[]): HskLevel {
  const words = realWordPhrases(entries);
  if (words.length === 0) return 1;

  const scored = words.map((e) => {
    if (e.hsk === 1 || e.hsk === 2 || e.hsk === 3) return e.hsk;
    return 2;
  });
  const avg = scored.reduce((a, b) => a + b, 0) / scored.length;
  if (avg <= 1.4) return 1;
  if (avg <= 2.4) return 2;
  return 3;
}

function vocabForRefresh(entries: VocabEntry[]) {
  const learnedMs = getLearnedAvgMs();
  return realWordPhrases(entries).map((e) => {
    const count = e.responseCount ?? 0;
    const avgSeconds =
      count > 0 ? Math.round((e.totalResponseMs ?? 0) / count / 100) / 10 : undefined;
    return {
      hanzi: e.hanzi,
      pinyin: e.pinyin,
      english: e.english,
      type: e.type,
      hsk: e.hsk,
      status: isPerformanceLearned(e, learnedMs) ? 'learned' : e.status,
      avgSeconds,
    };
  });
}

export async function countAddedSinceLastRefresh(): Promise<number> {
  const meta = getQuizRefreshMeta();
  const all = await getAllEntries();
  const current = countWordPhrases(all);
  if (!meta) return current;
  return Math.max(0, current - meta.wordsAtLastRefresh);
}

export async function refreshQuizContent(): Promise<QuizRefreshResult> {
  const entries = await getAllEntries();
  const lastRefresh = getQuizRefreshMeta()?.lastQuizRefreshAt ?? 0;
  const newWordsSinceLast = await countAddedSinceLastRefresh();
  const analysedHsk = analyseHskLevel(entries);
  const vocab = vocabForRefresh(entries);

  if (vocab.length < 3) {
    throw new Error('Add at least 3 words or phrases to your library before refreshing quiz content.');
  }

  const generated = await regenerateQuizBank(vocab, analysedHsk);
  if (generated.length === 0) {
    throw new Error('Gemini returned no questions — try again.');
  }

  const now = Date.now();
  const batchId = `batch-${now}`;

  await replaceQuizQuestions(
    generated.map((q) => ({
      english: q.english,
      hanzi: q.hanzi,
      blankHanzi: q.blankHanzi,
      level: q.level,
      hskHint: q.hskHint,
      sourceVocab: q.sourceVocab,
      batchId,
      createdAt: now,
    })),
  );

  setQuizRefreshMeta({
    lastQuizRefreshAt: now,
    wordsAtLastRefresh: countWordPhrases(entries),
    questionCount: generated.length,
    batchId,
    analysedHsk,
  });

  const flashcardsQueued = await queueNewEntriesForFlashcards(lastRefresh);

  return {
    questionsGenerated: generated.length,
    newWordsSinceLast,
    analysedHsk,
    flashcardsQueued,
  };
}
