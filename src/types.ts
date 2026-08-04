export const TOPICS = [
  'Time',
  'Dates',
  'Questions',
  'Places',
  'People',
  'Family',
  'Food',
  'Jobs',
  'Study',
  'Shopping',
  'Directions',
  'Festivals',
  'Adjectives',
  'Grammar',
  'Measure Words',
  'Introductions',
  'Pets',
  'Other',
] as const;

/** Seed/migration list of dedicated measure-word entries. */
export const MEASURE_WORD_HANZI = ['个', '本', '杯', '口', '只', '两', '块'] as const;

/** Built-in topic labels; custom topics are plain strings. */
export type BuiltinTopic = (typeof TOPICS)[number];
export type Topic = string;

export type EntryType = 'word' | 'phrase' | 'sentence';
export type HskLevel = 1 | 2 | 3 | 'unknown';
export type EntryStatus = 'learning' | 'learned';

export interface VocabEntry {
  id?: number;
  hanzi: string;
  pinyin: string;
  english: string;
  type: EntryType;
  topics: Topic[];
  hsk: HskLevel;
  /** Editable personal notes. */
  notes: string;
  /** Read-only tip about grammar / usage (should not restate the gloss). */
  extraDetail: string;
  /** -1 down, 0 none, 1 up for the current extraDetail. */
  extraDetailRating: -1 | 0 | 1;
  /** Previously disliked extraDetail texts — used when regenerating. */
  rejectedDetails: string[];
  /** Read-only tip about characters / radicals / structure. */
  hanziDetail: string;
  hanziDetailRating: -1 | 0 | 1;
  rejectedHanziDetails: string[];
  status: EntryStatus;
  ease: number;
  interval: number;
  nextReviewAt: number;
  lastResult: 'correct' | 'wrong' | 'timeout' | null;
  timerMs: number;
  correctCount: number;
  wrongCount: number;
  /** Sum of response times (ms) across flashcard reviews. */
  totalResponseMs: number;
  /** Number of timed flashcard responses recorded. */
  responseCount: number;
  createdAt: number;
  updatedAt: number;
}

export type SeedEntry = {
  hanzi: string;
  english: string;
  type: EntryType;
  topics: Topic[];
  hsk: HskLevel;
  pinyin?: string;
  notes?: string;
  status?: EntryStatus;
};

export interface EnrichResult {
  hanzi: string;
  english: string;
  type: EntryType;
  topics: Topic[];
  hsk: HskLevel;
  components: Array<{
    hanzi: string;
    english: string;
    type: EntryType;
    topics: Topic[];
    hsk: HskLevel;
    notes?: string;
  }>;
  notes?: string;
}

export interface ComposeResult {
  /** What the Chinese means in plain English. */
  meaning: string;
  /** true when Chinese input is fine (or English→Chinese draft is ready). */
  ok: boolean;
  /** 'check' = Chinese input reviewed; 'translate' = English turned into Chinese. */
  mode: 'check' | 'translate';
  /**
   * For translate mode: Chinese draft using learned vocab when possible.
   * For check mode: optional corrected sentence — UI hides this until the learner asks.
   */
  translation: string;
  usedOnlyLearned: boolean;
  unknownWords: Array<{
    hanzi: string;
    english: string;
    pinyin?: string;
    type: EntryType;
    topics: Topic[];
    hsk: HskLevel;
  }>;
  /** What’s wrong / tips — do not label HSK bands unless something is above HSK 3. */
  notes?: string;
}

/** AI coaching when a Forms attempt ≠ expected sentence. */
export interface Level3Feedback {
  /** True if the attempt still conveys the English prompt correctly. */
  meaningOk: boolean;
  /** Explain a mistake, or congratulate a valid alternative. */
  note: string;
  /** Novel correct words/phrases in the attempt that aren’t on the Shelf. */
  newWords: Array<{
    hanzi: string;
    english: string;
    type: EntryType;
    topics: Topic[];
    hsk: HskLevel;
  }>;
  /** True when praise is about a different-but-valid sentence pattern. */
  newStructure: boolean;
}

export type QuizLevel = 1 | 2 | 3;

/** AI-generated sentence exercise stored for Sentence Maker / quiz practice. */
export interface QuizQuestion {
  id?: number;
  english: string;
  hanzi: string;
  blankHanzi: string[];
  level: QuizLevel;
  hskHint: HskLevel;
  sourceVocab: string[];
  batchId: string;
  createdAt: number;
}

export interface QuizRefreshMeta {
  lastQuizRefreshAt: number;
  wordsAtLastRefresh: number;
  questionCount: number;
  batchId: string;
  analysedHsk?: HskLevel;
}

export interface QuizRefreshResult {
  questionsGenerated: number;
  newWordsSinceLast: number;
  analysedHsk: HskLevel;
  flashcardsQueued: number;
}
