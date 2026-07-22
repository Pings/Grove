import { useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, getQuizQuestions, normalizeHanzi, upsertEntry } from '../db/schema';
import { generateSentenceExercise, explainFormsMistake } from '../lib/gemini';
import { getApiKey, getLearnedAvgMs } from '../lib/settings';
import { isPerformanceLearned, waterVocabEntries } from '../lib/flashcards';
import { toPinyin } from '../lib/pinyin';
import {
  buildExerciseFromQuizQuestion,
  buildExerciseFromSentence,
  buildWordBank,
  checkBlanksFilled,
  checkFullSentence,
  exerciseFromGemini,
  normalizeExerciseHanzi,
  pickQuizQuestion,
  pickSentenceTemplates,
  pickUserSentences,
  quizQuestionUsesDemo,
  segmentSentence,
  type MakerExercise,
  type MakerLevel,
  type MakerMcOption,
  type MakerSegment,
} from '../lib/sentenceMaker';
import { isGrowthDemoEntry } from '../data/growthDemos';
import type { Level3Feedback, VocabEntry } from '../types';

const SESSION_SIZE = 10;

const LEVELS: { level: MakerLevel; title: string; hint: string }[] = [
  { level: 1, title: 'Level 1', hint: 'Fill in a few missing words' },
  { level: 2, title: 'Level 2', hint: 'Type sentences from Lines' },
  { level: 3, title: 'Level 3', hint: 'Type new sentences from your words' },
];

function renderSegments(
  segments: MakerSegment[],
  blanks: Record<number, string>,
  revealed: boolean,
  exercise: MakerExercise,
  onClearBlank?: (blankId: number) => void,
) {
  return segments.map((seg, idx) => {
    if (seg.kind === 'text') {
      return (
        <span key={`t-${idx}`} style={{ fontFamily: 'var(--font-zh-display)' }}>
          {seg.value}
        </span>
      );
    }
    const blank = exercise.blanks.find((b) => b.id === seg.blankId);
    const filled = blanks[seg.blankId];
    const showAnswer = revealed && blank;
    if (filled) {
      return (
        <button
          key={`b-${seg.blankId}`}
          type="button"
          className="maker-blank filled"
          disabled={revealed || !onClearBlank}
          onClick={() => onClearBlank?.(seg.blankId)}
        >
          {filled}
        </button>
      );
    }
    if (showAnswer) {
      return (
        <span key={`b-${seg.blankId}`} className="maker-blank revealed">
          {blank.answerHanzi}
        </span>
      );
    }
    return (
      <span key={`b-${seg.blankId}`} className="maker-blank empty">
        ___
      </span>
    );
  });
}

export function SentenceMakerPage() {
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [level, setLevel] = useState<MakerLevel>(1);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exercise, setExercise] = useState<MakerExercise | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [sessionStats, setSessionStats] = useState({ correct: 0, wrong: 0 });
  const [blankAnswers, setBlankAnswers] = useState<Record<number, string>>({});
  const [usedChipIds, setUsedChipIds] = useState<Set<string>>(new Set());
  const [typedSentence, setTypedSentence] = useState('');
  const [wordBank, setWordBank] = useState<MakerMcOption[]>([]);
  const [wasCorrect, setWasCorrect] = useState(false);
  const [quizPoolSize, setQuizPoolSize] = useState(0);
  const [feedback, setFeedback] = useState<Level3Feedback | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [addingWords, setAddingWords] = useState(false);
  const [wordsAdded, setWordsAdded] = useState(false);
  const usedQuizIds = useRef(new Set<number>());
  const usedSentenceIds = useRef(new Set<number>());
  const usedExerciseHanzi = useRef(new Set<string>());

  useEffect(() => {
    const sub = liveQuery(() => db.entries.toArray()).subscribe({
      next: setEntries,
      error: console.error,
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    if (level === 2) {
      setQuizPoolSize(
        entries.filter((e) => e.type === 'sentence' && !isGrowthDemoEntry(e)).length,
      );
      return;
    }
    const quizLevels = level === 1 ? ([1, 2] as const) : ([3] as const);
    const sub = liveQuery(async () => {
      let total = 0;
      for (const lv of quizLevels) {
        const rows = await db.quizQuestions.where('level').equals(lv).toArray();
        total += rows.filter((q) => !quizQuestionUsesDemo(q)).length;
      }
      return total;
    }).subscribe({
      next: setQuizPoolSize,
      error: console.error,
    });
    return () => sub.unsubscribe();
  }, [level, entries]);

  useEffect(() => {
    const onInsert = (event: Event) => {
      const hanzi = (event as CustomEvent<{ hanzi?: string }>).detail?.hanzi?.trim();
      if (!hanzi) return;
      setTypedSentence((prev) => {
        const trimmed = prev.trimEnd();
        if (!trimmed) return hanzi;
        return `${trimmed}${hanzi}`;
      });
    };
    window.addEventListener('hanzi-board:insert', onInsert);
    return () => window.removeEventListener('hanzi-board:insert', onInsert);
  }, []);

  const vocab = useMemo(
    () =>
      entries.filter(
        (e) => (e.type === 'word' || e.type === 'phrase') && !isGrowthDemoEntry(e),
      ),
    [entries],
  );

  const learnedVocab = useMemo(
    () => vocab.filter((e) => isPerformanceLearned(e, getLearnedAvgMs())),
    [vocab],
  );

  const templateSource = useMemo(() => {
    const threshold = getLearnedAvgMs();
    const real = entries.filter((e) => !isGrowthDemoEntry(e));
    const learned = real.filter((e) => isPerformanceLearned(e, threshold));
    return learned.length > 0 ? learned : real;
  }, [entries]);

  const userSentenceCount = useMemo(
    () => entries.filter((e) => e.type === 'sentence' && !isGrowthDemoEntry(e)).length,
    [entries],
  );

  function rememberExercise(ex: MakerExercise | null): MakerExercise | null {
    if (!ex) return null;
    usedExerciseHanzi.current.add(normalizeExerciseHanzi(ex.fullHanzi));
    return ex;
  }

  async function geminiExercise(forLevel: 1 | 3): Promise<MakerExercise | null> {
    if (!getApiKey() || vocab.length === 0) return null;
    const pool = (learnedVocab.length > 0 ? learnedVocab : vocab).map((e) => ({
      hanzi: e.hanzi,
      pinyin: e.pinyin,
      english: e.english,
    }));
    const avoid = [...usedExerciseHanzi.current];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const gem = await generateSentenceExercise(pool, forLevel, avoid);
      const ex = exerciseFromGemini(gem, vocab, forLevel);
      if (!ex) continue;
      const key = normalizeExerciseHanzi(ex.fullHanzi);
      if (usedExerciseHanzi.current.has(key)) {
        avoid.push(ex.fullHanzi);
        continue;
      }
      return rememberExercise(ex);
    }
    return null;
  }

  async function buildExercise(): Promise<MakerExercise | null> {
    if (level === 2) {
      const pool = pickUserSentences(entries.filter((e) => !isGrowthDemoEntry(e)));
      let next = pool.find((s) => s.id != null && !usedSentenceIds.current.has(s.id));
      if (!next && pool.length > 0) {
        usedSentenceIds.current.clear();
        next = pool.find(
          (s) => !usedExerciseHanzi.current.has(normalizeExerciseHanzi(s.hanzi)),
        ) ?? pool[0];
      }
      if (!next) return null;
      const ex = buildExerciseFromSentence(next, vocab, 2);
      if (ex && next.id != null) usedSentenceIds.current.add(next.id);
      return rememberExercise(ex);
    }

    if (level === 1) {
      const bank = await getQuizQuestions();
      for (const quizLevel of [1, 2] as const) {
        let quizQ = pickQuizQuestion(
          bank,
          quizLevel,
          usedQuizIds.current,
          usedExerciseHanzi.current,
        );
        if (!quizQ) {
          // Allow reuse of ids once the bank is exhausted, still skip recent hanzi.
          const freed = new Set<number>();
          quizQ = pickQuizQuestion(bank, quizLevel, freed, usedExerciseHanzi.current);
        }
        if (quizQ) {
          const ex = buildExerciseFromQuizQuestion(quizQ, vocab, 1);
          if (ex) {
            if (quizQ.id != null) usedQuizIds.current.add(quizQ.id);
            return rememberExercise(ex);
          }
        }
      }

      const templates = pickSentenceTemplates(templateSource, vocab);
      for (const template of templates.slice(0, 15)) {
        const key = normalizeExerciseHanzi(template.hanzi);
        if (usedExerciseHanzi.current.has(key)) continue;
        const ex = buildExerciseFromSentence(template, vocab, 1);
        if (ex) return rememberExercise(ex);
      }

      return geminiExercise(1);
    }

    // Level 3 — new sentences from vocab
    const bank = await getQuizQuestions();
    let quizQ = pickQuizQuestion(bank, 3, usedQuizIds.current, usedExerciseHanzi.current);
    if (!quizQ) {
      usedQuizIds.current.clear();
      quizQ = pickQuizQuestion(bank, 3, usedQuizIds.current, usedExerciseHanzi.current);
    }
    if (quizQ) {
      const ex = buildExerciseFromQuizQuestion(quizQ, vocab, 3);
      if (ex) {
        if (quizQ.id != null) usedQuizIds.current.add(quizQ.id);
        return rememberExercise(ex);
      }
    }

    return geminiExercise(3);
  }

  function setupExerciseUI(ex: MakerExercise) {
    setExercise(ex);
    setRevealed(false);
    setBlankAnswers({});
    setUsedChipIds(new Set());
    setTypedSentence('');
    setWasCorrect(false);
    setFeedback(null);
    setFeedbackLoading(false);
    setAddingWords(false);
    setWordsAdded(false);

    if (level === 1) {
      setWordBank(buildWordBank(ex.blanks, vocab));
    } else {
      setWordBank([]);
    }
  }

  async function loadExercise(at: number) {
    setLoading(true);
    setError('');
    try {
      const ex = await buildExercise();
      if (!ex) {
        if (level === 2) {
          setError('Add some sentences to Lines first — Level 2 uses those.');
        } else if (level === 3) {
          setError(
            vocab.length < 3
              ? 'Add more words/phrases first.'
              : 'Could not build a new sentence — set a Gemini key in Settings (or refresh quiz content).',
          );
        } else {
          setError(
            vocab.length < 3
              ? 'Add more words to your Shelf first.'
              : 'Could not build an exercise — add Lines sentences or words, or set a Gemini key in Settings.',
          );
        }
        setExercise(null);
        return;
      }
      setupExerciseUI(ex);
      setIndex(at);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exercise.');
      setExercise(null);
    } finally {
      setLoading(false);
    }
  }

  async function startSession() {
    setSessionStats({ correct: 0, wrong: 0 });
    usedQuizIds.current = new Set();
    usedSentenceIds.current = new Set();
    usedExerciseHanzi.current = new Set();
    setActive(true);
    await loadExercise(0);
  }

  function endSession() {
    setActive(false);
    setExercise(null);
    setRevealed(false);
  }

  function recordOutcome(correct: boolean) {
    setRevealed(true);
    setWasCorrect(correct);
    setSessionStats((s) => ({
      ...s,
      [correct ? 'correct' : 'wrong']: s[correct ? 'correct' : 'wrong'] + 1,
    }));

    if (!exercise) return;
    const watered = new Map<number, VocabEntry>();
    const add = (entry: VocabEntry | null | undefined) => {
      if (entry?.id != null && entry.type !== 'sentence') watered.set(entry.id, entry);
    };
    for (const span of segmentSentence(exercise.fullHanzi, vocab)) add(span.entry);
    if (typedSentence.trim()) {
      for (const span of segmentSentence(typedSentence, vocab)) add(span.entry);
    }
    for (const blank of exercise.blanks) {
      add(vocab.find((v) => v.hanzi === blank.answerHanzi));
      const filled = blankAnswers[blank.id];
      if (filled) add(vocab.find((v) => v.hanzi === filled));
    }
    void waterVocabEntries([...watered.values()]);
  }

  function pickChip(chip: MakerMcOption) {
    if (revealed || !exercise) return;
    if (usedChipIds.has(chip.id)) return;

    const nextBlank = exercise.blanks.find((b) => !blankAnswers[b.id]);
    if (!nextBlank) return;

    setBlankAnswers((prev) => ({ ...prev, [nextBlank.id]: chip.hanzi }));
    setUsedChipIds((prev) => new Set(prev).add(chip.id));
  }

  function clearBlank(blankId: number) {
    if (revealed || !exercise) return;
    const hanzi = blankAnswers[blankId];
    if (!hanzi) return;

    const chip = wordBank.find((c) => c.hanzi === hanzi && usedChipIds.has(c.id));
    setBlankAnswers((prev) => {
      const next = { ...prev };
      delete next[blankId];
      return next;
    });
    if (chip) {
      setUsedChipIds((prev) => {
        const next = new Set(prev);
        next.delete(chip.id);
        return next;
      });
    }
  }

  function filledSentenceFromBlanks(): string {
    if (!exercise) return '';
    return exercise.segments
      .map((seg) => {
        if (seg.kind === 'text') return seg.value;
        return blankAnswers[seg.blankId] ?? '___';
      })
      .join('');
  }

  async function requestMistakeFeedback(userHanzi: string) {
    if (!exercise) return;
    setFeedback(null);
    setWordsAdded(false);

    if (!getApiKey()) {
      setFeedback({
        meaningOk: false,
        note: 'Add a Gemini key in Settings to get an explanation when answers differ.',
        newWords: [],
        newStructure: false,
      });
      return;
    }

    setFeedbackLoading(true);
    try {
      const fb = await explainFormsMistake({
        level,
        englishPrompt: exercise.english,
        expectedHanzi: exercise.fullHanzi,
        userHanzi,
        knownVocab: vocab.map((e) => ({ hanzi: e.hanzi, english: e.english })),
      });

      const known = new Set(entries.map((e) => normalizeHanzi(e.hanzi)));
      const filtered: Level3Feedback = {
        ...fb,
        newWords: fb.newWords.filter((w) => !known.has(normalizeHanzi(w.hanzi))),
      };
      setFeedback(filtered);

      // Accept valid alternatives for typed levels (and rare L1 cases).
      if (filtered.meaningOk) {
        setWasCorrect(true);
        setSessionStats((s) => ({
          correct: s.correct + 1,
          wrong: Math.max(0, s.wrong - 1),
        }));
      }
    } catch (err) {
      setFeedback({
        meaningOk: false,
        note: err instanceof Error ? err.message : 'Could not get coaching feedback.',
        newWords: [],
        newStructure: false,
      });
    } finally {
      setFeedbackLoading(false);
    }
  }

  function checkBlanks() {
    if (!exercise || revealed) return;
    const ok = checkBlanksFilled(exercise.blanks, blankAnswers);
    recordOutcome(ok);
    if (!ok) {
      void requestMistakeFeedback(filledSentenceFromBlanks());
    }
  }

  async function checkTyped() {
    if (!exercise || revealed) return;
    const ok = checkFullSentence(typedSentence, exercise.fullHanzi);
    recordOutcome(ok);
    if (!ok) {
      await requestMistakeFeedback(typedSentence.trim());
    }
  }

  async function addSuggestedWords() {
    if (!feedback?.newWords.length || addingWords || wordsAdded) return;
    setAddingWords(true);
    try {
      for (const w of feedback.newWords) {
        await upsertEntry({
          hanzi: w.hanzi,
          pinyin: toPinyin(w.hanzi),
          english: w.english,
          type: w.type === 'phrase' ? 'phrase' : 'word',
          topics: w.topics.length > 0 ? w.topics : ['Other'],
          hsk: w.hsk,
          notes: '',
          status: 'learning',
        });
      }
      setWordsAdded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add words.');
    } finally {
      setAddingWords(false);
    }
  }

  async function nextExercise() {
    const next = index + 1;
    if (next >= SESSION_SIZE) {
      endSession();
      return;
    }
    await loadExercise(next);
  }

  const uncoveredSpans = useMemo(() => {
    if (!exercise || level === 1 || !revealed) return [];
    return segmentSentence(typedSentence, vocab).filter((s) => !s.entry && s.text.trim());
  }, [exercise, level, revealed, typedSentence, vocab]);

  const sessionDone =
    !active && sessionStats.correct + sessionStats.wrong > 0;

  // Enter: submit when ready; Enter again: next question.
  useEffect(() => {
    if (!active || !exercise) return;
    const current = exercise;

    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter' || e.isComposing || e.repeat) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      // Allow Enter from inputs (submit) and when not typing in a textarea.
      if (tag === 'TEXTAREA') return;

      if (revealed) {
        if (feedbackLoading) return;
        e.preventDefault();
        void nextExercise();
        return;
      }

      if (level === 1) {
        const ready = current.blanks.every((b) => Boolean(blankAnswers[b.id]));
        if (!ready) return;
        e.preventDefault();
        checkBlanks();
        return;
      }

      if (!typedSentence.trim()) return;
      e.preventDefault();
      void checkTyped();
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    active,
    exercise,
    revealed,
    feedbackLoading,
    level,
    blankAnswers,
    typedSentence,
    index,
  ]);

  return (
    <div className="stack">
      <header className="page-header">
        <h1>
          Forms <span className="page-title-zh">句式</span>
        </h1>
        <p>
          Fill gaps, type Lines you saved, or grow new sentences from Shelf words. Using a word here
          waters its plant — same as Tend.
        </p>
      </header>

      <section className="panel stack">
        <div className="maker-levels">
          {LEVELS.map((item) => (
            <button
              key={item.level}
              type="button"
              className={`maker-level-btn ${level === item.level ? 'active' : ''}`}
              disabled={active}
              onClick={() => setLevel(item.level)}
            >
              <span className="maker-level-title">{item.title}</span>
              <span className="maker-level-hint">{item.hint}</span>
            </button>
          ))}
        </div>

        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void startSession()}
            disabled={active || loading}
          >
            {loading ? 'Loading…' : 'Start session'}
          </button>
          {active && (
            <button type="button" className="btn btn-ghost" onClick={endSession}>
              End
            </button>
          )}
        </div>

        <div className="muted">
          {learnedVocab.length} learned · {vocab.length} words/phrases · {userSentenceCount} sentences
          {level === 2
            ? ` · ${quizPoolSize} saved for Level 2`
            : quizPoolSize > 0
              ? ` · ${quizPoolSize} refreshed (L${level === 1 ? '1–2' : '3'})`
              : ''}
          {active && ` · ${index + 1} / ${SESSION_SIZE}`}
          {active && ` · ${sessionStats.correct}✓ ${sessionStats.wrong}✗`}
        </div>
        {error && <div className="alert alert-error">{error}</div>}
      </section>

      {!active && !sessionDone && (
        <div className="panel empty">
          {entries.length === 0
            ? 'Your Shelf is empty — gather vocabulary first.'
            : 'Pick a level and start a session.'}
        </div>
      )}

      {sessionDone && (
        <div className="panel alert alert-info">
          Session done — {sessionStats.correct} correct, {sessionStats.wrong} wrong.
        </div>
      )}

      {active && exercise && (
        <section className="panel stack maker-stage">
          <div className="badge">{LEVELS.find((l) => l.level === level)?.title}</div>

          <div>
            <div className="muted" style={{ fontWeight: 600, marginBottom: '0.35rem' }}>
              English
            </div>
            <div style={{ fontSize: '1.25rem', lineHeight: 1.4 }}>{exercise.english}</div>
          </div>

          {level === 1 && (
            <>
              <div className="sentence-display hanzi-xl">
                {renderSegments(
                  exercise.segments,
                  blankAnswers,
                  revealed,
                  exercise,
                  clearBlank,
                )}
              </div>
              <div className="word-bank">
                {wordBank.map((chip) => {
                  const used = usedChipIds.has(chip.id);
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      className={`chip ${used ? 'used' : ''}`}
                      disabled={revealed || used}
                      onClick={() => pickChip(chip)}
                      style={{ fontFamily: 'var(--font-zh-display)' }}
                    >
                      {chip.hanzi}
                    </button>
                  );
                })}
              </div>
              {!revealed && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={checkBlanks}
                  disabled={exercise.blanks.some((b) => !blankAnswers[b.id])}
                >
                  Check
                </button>
              )}
              {!revealed && (
                <div className="muted" style={{ fontSize: '0.88rem' }}>
                  Tap chips to fill blanks left to right. Tap a filled blank to undo.
                </div>
              )}
            </>
          )}

          {(level === 2 || level === 3) && (
            <>
              <label className="field">
                Your Chinese sentence
                <input
                  type="text"
                  value={typedSentence}
                  onChange={(e) => setTypedSentence(e.target.value)}
                  placeholder={
                    level === 2 ? 'Type the sentence you added…' : 'Type the new sentence…'
                  }
                  disabled={revealed}
                  style={{ fontFamily: 'var(--font-zh-display)', fontSize: '1.35rem' }}
                  autoComplete="off"
                />
              </label>
              {!revealed && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void checkTyped()}
                  disabled={!typedSentence.trim()}
                >
                  Check
                </button>
              )}
            </>
          )}

          {revealed && (
            <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
              {wasCorrect && (
                <div className="alert alert-info" style={{ width: '100%' }}>
                  {feedback?.meaningOk ? 'Accepted — good alternative!' : 'Correct!'}
                </div>
              )}

              {feedbackLoading && (
                <div className="muted" style={{ width: '100%' }}>
                  Asking Gemini why…
                </div>
              )}

              {feedback?.note && (
                <div
                  className={`alert ${feedback.meaningOk ? 'alert-info' : 'alert-warn'}`}
                  style={{ width: '100%', textAlign: 'left' }}
                >
                  {feedback.note}
                </div>
              )}

              {feedback &&
                (feedback.meaningOk || feedback.newStructure) &&
                feedback.newWords.length > 0 && (
                  <div className="stack" style={{ width: '100%', alignItems: 'stretch' }}>
                    <div className="muted" style={{ textAlign: 'left', fontSize: '0.9rem' }}>
                      New words you used:{' '}
                      {feedback.newWords
                        .map((w) => `${w.hanzi} (${w.english})`)
                        .join(' · ')}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={addingWords || wordsAdded}
                      onClick={() => void addSuggestedWords()}
                    >
                      {wordsAdded
                        ? 'Added to Shelf'
                        : addingWords
                          ? 'Adding…'
                          : 'Add these to Shelf'}
                    </button>
                  </div>
                )}

              <div className="hanzi-xl">{exercise.fullHanzi}</div>
              <div className="pinyin-lg">{exercise.fullPinyin}</div>

              {level > 1 && uncoveredSpans.length > 0 && (
                <div className="alert alert-warn" style={{ width: '100%' }}>
                  Not in your Shelf:{' '}
                  {uncoveredSpans.map((s) => s.text).join(' · ')}
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void nextExercise()}
                disabled={feedbackLoading}
              >
                {index + 1 >= SESSION_SIZE ? 'Finish' : 'Next'}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
