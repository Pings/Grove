import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { liveQuery } from 'dexie';
import { db } from '../db/schema';
import type { VocabEntry } from '../types';
import { ExtraDetailPanel } from '../components/ExtraDetailPanel';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { Modal } from '../components/Modal';
import { HskBadge } from '../components/Badges';
import { ToneContour, tonesFromOptionId } from '../components/ToneContour';
import {
  applyReview,
  buildQuestion,
  buildSessionQueue,
  countDueEntries,
  drillModeFor,
  filterEntriesForMode,
  formatAvgResponse,
  isPerformanceLearned,
  isToneMode,
  sandhiNoteFor,
  sandhiSpokenTones,
  type CardMode,
  type LockedQuestion,
  type McOption,
  type ReviewOutcome,
} from '../lib/flashcards';
import { SpeakButton } from '../components/SpeakButton';
import { getLearnedAvgMs } from '../lib/settings';
import { pronounceHanzi, stopPronouncing } from '../lib/pronounce';
import { tonesFromPinyin } from '../lib/pinyin';

const MODES: Array<{ id: CardMode; title: string }> = [
  { id: 'hanzi-to-english', title: 'Hanzi → English' },
  { id: 'english-to-hanzi', title: 'English → Hanzi' },
  { id: 'pinyin-to-hanzi', title: 'Pinyin → Hanzi' },
  { id: 'hanzi-to-tone', title: 'Hanzi → Tone' },
  { id: 'measure-words', title: 'Measure Words' },
];

export function FlashcardsPage() {
  const location = useLocation();
  const onTendPage = location.pathname === '/flashcards';
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [mode, setMode] = useState<CardMode>('hanzi-to-english');
  const [queue, setQueue] = useState<VocabEntry[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [active, setActive] = useState(false);
  const [sessionStats, setSessionStats] = useState({ correct: 0, wrong: 0, timeout: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showStudyCard, setShowStudyCard] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<ReviewOutcome | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const settlingRef = useRef(false);
  const remainingMsRef = useRef(0);
  const activeElapsedRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const onTendPageRef = useRef(onTendPage);
  onTendPageRef.current = onTendPage;

  useEffect(() => {
    const sub = liveQuery(() => db.entries.toArray()).subscribe({
      next: setEntries,
      error: console.error,
    });
    return () => sub.unsubscribe();
  }, []);

  const current = useMemo(() => {
    const queued = queue[index];
    if (!queued?.id) return queued ?? null;
    return entries.find((e) => e.id === queued.id) ?? queued;
  }, [queue, index, entries]);

  const choicePool = useMemo(
    () => filterEntriesForMode(entries, mode),
    [entries, mode],
  );

  const [choices, setChoices] = useState<McOption[]>([]);
  const [locked, setLocked] = useState<LockedQuestion | null>(null);
  const toneMode = isToneMode(mode);

  // Lock prompt + options per card — don't reshuffle when entries refresh after a click
  useEffect(() => {
    if (!active || !current?.id) {
      setChoices([]);
      setLocked(null);
      return;
    }
    const question = buildQuestion(current, choicePool, mode);
    setChoices(question.choices);
    setLocked(question);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only new card / mode, not DB refresh
  }, [current?.id, mode, index, active]);

  // Reset per-card timer / response clock (does not depend on route — pause is separate).
  useEffect(() => {
    if (!active || !current || revealed) return;
    settlingRef.current = false;
    setSelectedId(null);
    setShowStudyCard(false);
    setLastOutcome(null);
    activeElapsedRef.current = 0;
    lastTickRef.current = null;

    if (toneMode) {
      remainingMsRef.current = 0;
      setRemainingMs(0);
      return;
    }

    const total = current.timerMs || 8000;
    remainingMsRef.current = total;
    setRemainingMs(total);
  }, [active, current?.id, index, revealed, mode, toneMode]);

  // Run the countdown only while Tend is the active tab and the browser tab is visible.
  useEffect(() => {
    if (!active || !current || revealed || toneMode) return;

    const tick = () => {
      const now = Date.now();
      const running = onTendPageRef.current && document.visibilityState === 'visible';
      if (!running) {
        lastTickRef.current = null;
        return;
      }
      if (lastTickRef.current == null) {
        lastTickRef.current = now;
        return;
      }
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;
      activeElapsedRef.current += dt;
      remainingMsRef.current = Math.max(0, remainingMsRef.current - dt);
      setRemainingMs(remainingMsRef.current);
      if (remainingMsRef.current <= 0) {
        void settle('timeout');
      }
    };

    const id = window.setInterval(tick, 50);
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        lastTickRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      lastTickRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, current?.id, index, revealed, mode, toneMode, onTendPage]);

  // Stop speech when leaving Tend mid-session.
  useEffect(() => {
    if (!onTendPage) stopPronouncing();
  }, [onTendPage]);

  // Auto-play pronunciation for tone mode (citation tones, Gemini TTS).
  useEffect(() => {
    if (!active || !current?.hanzi || !toneMode || revealed || !onTendPage) return;
    const text = current.hanzi;
    const timer = window.setTimeout(() => {
      void pronounceHanzi(text, { citationTones: true }).catch((err) => {
        console.warn('Tone speak failed:', err);
      });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      stopPronouncing();
    };
  }, [active, current?.id, current?.hanzi, toneMode, revealed, index, onTendPage]);

  useEffect(() => {
    if (current) setNotesDraft(current.notes || '');
  }, [current?.id, current?.notes]);

  // Enter advances after a reveal (or closes the study card).
  useEffect(() => {
    if (!active) return;

    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter' || e.isComposing || e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;

      if (showStudyCard) {
        e.preventDefault();
        void saveUserNotes();
        setShowStudyCard(false);
        nextCard();
        return;
      }

      if (!revealed || !lastOutcome) return;
      e.preventDefault();
      nextCard();
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, revealed, lastOutcome, showStudyCard, index, queue.length]);

  function startSession() {
    const due = buildSessionQueue(entries, 25, mode);
    setQueue(due);
    setIndex(0);
    setRevealed(false);
    setSelectedId(null);
    setShowStudyCard(false);
    setLastOutcome(null);
    settlingRef.current = false;
    setSessionStats({ correct: 0, wrong: 0, timeout: 0 });
    setActive(due.length > 0);
  }

  async function settle(outcome: ReviewOutcome, pickedId?: string) {
    if (!current?.id || settlingRef.current) return;
    settlingRef.current = true;
    setRevealed(true);
    setLastOutcome(outcome);
    if (pickedId) setSelectedId(pickedId);
    const responseMs = Math.max(0, Math.round(activeElapsedRef.current));
    const patch = applyReview(current, outcome, responseMs);
    await db.entries.update(current.id, patch);
    setSessionStats((s) => ({
      ...s,
      [outcome === 'correct' ? 'correct' : outcome === 'wrong' ? 'wrong' : 'timeout']:
        s[outcome === 'correct' ? 'correct' : outcome === 'wrong' ? 'wrong' : 'timeout'] + 1,
    }));
    if (outcome !== 'correct') {
      setShowStudyCard(true);
    }
  }

  function pickOption(option: McOption) {
    if (revealed) {
      if (option.id === selectedId || (selectedId == null && option.isCorrect)) {
        nextCard();
      }
      return;
    }
    if (settlingRef.current) return;
    void settle(option.isCorrect ? 'correct' : 'wrong', option.id);
  }

  async function saveUserNotes() {
    if (!current?.id) return;
    await db.entries.update(current.id, {
      notes: notesDraft,
      updatedAt: Date.now(),
    });
  }

  function nextCard() {
    if (index + 1 >= queue.length) {
      setActive(false);
      setQueue([]);
      setShowStudyCard(false);
      return;
    }
    settlingRef.current = false;
    setSelectedId(null);
    setShowStudyCard(false);
    setLastOutcome(null);
    setIndex((i) => i + 1);
    setRevealed(false);
  }

  const timerPct = useMemo(() => {
    if (!current || toneMode) return 0;
    return Math.max(0, Math.min(100, (remainingMs / (current.timerMs || 8000)) * 100));
  }, [current, remainingMs, toneMode]);

  const timerClass = timerPct < 25 ? 'danger' : timerPct < 50 ? 'warn' : '';
  const scoreRight = current?.correctCount ?? 0;
  const scoreWrong = current?.wrongCount ?? 0;
  const avgLabel = current ? formatAvgResponse(current) : null;
  const fast = current ? isPerformanceLearned(current, getLearnedAvgMs()) : false;
  const drill = drillModeFor(mode);
  const sandhiNote = current && toneMode ? sandhiNoteFor(current) : null;
  const spokenTones = current && toneMode ? sandhiSpokenTones(current) : null;
  const poolSize = filterEntriesForMode(entries, mode).length;
  const citationTones = current && toneMode ? tonesFromPinyin(current.pinyin) : [];

  return (
    <div className="stack">
      <header className="page-header">
        <h1>
          Tend <span className="page-title-zh">培</span>
        </h1>
      </header>

      <section className="panel stack">
        <div className="maker-levels tend-modes">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`maker-level-btn ${mode === item.id ? 'active' : ''}`}
              disabled={active}
              onClick={() => setMode(item.id)}
            >
              <span className="maker-level-title">{item.title}</span>
            </button>
          ))}
        </div>

        <div className="row">
          <button type="button" className="btn btn-primary" onClick={startSession} disabled={active}>
            Start session
          </button>
          {active && (
            <button type="button" className="btn btn-ghost" onClick={() => setActive(false)}>
              End
            </button>
          )}
        </div>
        <div className="muted">
          {mode === 'measure-words'
            ? `Measure words in library: ${poolSize}`
            : toneMode
              ? `Tone drills available: ${poolSize}`
              : `Due pool: ${countDueEntries(entries, mode)} words/phrases`}{' '}
          · Session {sessionStats.correct}✓ {sessionStats.wrong}✗
          {!toneMode && ` ${sessionStats.timeout}⏱`}
        </div>
      </section>

      {!active && queue.length === 0 && (
        <div className="panel empty">
          {entries.length === 0
            ? 'Your library is empty.'
            : poolSize === 0
              ? mode === 'measure-words'
                ? 'No measure words yet — add some under the Measure Words topic.'
                : 'Nothing to drill in this mode yet.'
              : 'Press Start session when you are ready.'}
        </div>
      )}

      {!active &&
        queue.length === 0 &&
        sessionStats.correct + sessionStats.wrong + sessionStats.timeout > 0 && (
          <div className="panel alert alert-info">
            Session done — {sessionStats.correct} correct, {sessionStats.wrong} wrong
            {!toneMode && `, ${sessionStats.timeout} timeouts`}.
          </div>
        )}

      {active && current && (
        <section className="panel">
          <div className="flash-stage">
            <div className="row" style={{ width: '100%', justifyContent: 'center', gap: '0.5rem' }}>
              <div className="badge">
                {index + 1} / {queue.length}
              </div>
              <div className="badge score-badge">
                {scoreRight}✓ · {scoreWrong}✗
                {avgLabel && ` · ${avgLabel}`}
              </div>
              {fast && <div className="badge badge-hsk1">Fast recall</div>}
            </div>

            {!toneMode && (
              <div className="timer-track" aria-hidden>
                <div className={`timer-fill ${timerClass}`} style={{ width: `${timerPct}%` }} />
              </div>
            )}

            <div className="tone-prompt-row">
              <div
                className={locked?.promptIsZh ? 'hanzi-xl' : ''}
                style={{
                  fontFamily: locked?.promptIsZh
                    ? 'var(--font-zh-display)'
                    : drill === 'pinyin-to-hanzi' ||
                        (mode === 'measure-words' && !locked?.promptIsZh)
                      ? 'var(--font-pinyin)'
                      : undefined,
                  fontSize:
                    locked?.promptIsZh ||
                    drill === 'pinyin-to-hanzi' ||
                    (mode === 'measure-words' && !locked?.promptIsZh)
                      ? undefined
                      : '1.6rem',
                }}
              >
                {locked?.prompt ?? ''}
              </div>
              {toneMode && <SpeakButton hanzi={current.hanzi} compact citationTones />}
            </div>
            {locked?.promptSubtext && (
              <div
                className={drill === 'hanzi-to-english' ? 'pinyin-lg' : 'muted'}
                style={drill === 'hanzi-to-english' ? undefined : { fontSize: '0.95rem' }}
              >
                {locked.promptSubtext}
              </div>
            )}

            <div className={`mc-grid ${toneMode ? 'mc-grid-tones' : ''}`}>
              {choices.map((option) => {
                const isSelected = selectedId === option.id;
                const showResult = revealed;
                const isCorrectOption = option.isCorrect;
                let cls = 'mc-option';
                if (showResult) {
                  if (isCorrectOption) cls += ' mc-correct';
                  else if (isSelected) cls += ' mc-wrong';
                  else cls += ' mc-dim';
                }

                const optionTones = toneMode ? tonesFromOptionId(option.id) : null;
                const optionIsZh =
                  drill === 'english-to-hanzi' ||
                  drill === 'pinyin-to-hanzi' ||
                  mode === 'measure-words';

                return (
                  <button
                    key={option.id}
                    type="button"
                    className={cls}
                    onClick={() => pickOption(option)}
                  >
                    {optionTones && (
                      <span className="mc-tone-option">
                        <ToneContour tones={optionTones} size="sm" />
                      </span>
                    )}
                    <span
                      className="mc-primary"
                      style={{
                        fontFamily: optionIsZh ? 'var(--font-zh)' : undefined,
                        fontWeight: optionIsZh ? 400 : undefined,
                      }}
                    >
                      {option.primary}
                    </span>
                    {option.secondary && (
                      <span className="mc-secondary">{option.secondary}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {revealed && toneMode && (
              <div className="tone-reveal muted">
                <div className="tone-reveal-pair">
                  <div className="tone-reveal-col">
                    <div className="tone-reveal-label">Citation (dictionary)</div>
                    <div className="tone-reveal-visual">
                      <ToneContour tones={citationTones} size="md" />
                    </div>
                    <div className="pinyin-lg" style={{ marginTop: '0.25rem' }}>
                      {current.pinyin}
                    </div>
                  </div>
                  {spokenTones && (
                    <div className="tone-reveal-col">
                      <div className="tone-reveal-label">Spoken (sandhi)</div>
                      <div className="tone-reveal-visual">
                        <ToneContour tones={spokenTones} size="md" />
                      </div>
                      <div className="muted" style={{ marginTop: '0.25rem', fontSize: '0.85rem' }}>
                        What you hear
                      </div>
                    </div>
                  )}
                </div>
                {sandhiNote && <div className="tone-sandhi-note">{sandhiNote}</div>}
              </div>
            )}

            {revealed && lastOutcome === 'correct' && (
              <div className="flash-continue-row">
                <button type="button" className="btn btn-primary" onClick={nextCard}>
                  Continue
                </button>
                {!toneMode && <SpeakButton hanzi={current.hanzi} compact />}
              </div>
            )}

            {revealed && lastOutcome && lastOutcome !== 'correct' && !showStudyCard && (
              <div className="flash-continue-row">
                <button type="button" className="btn btn-primary" onClick={nextCard}>
                  Continue
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowStudyCard(true)}
                >
                  Review card
                </button>
                {!toneMode && <SpeakButton hanzi={current.hanzi} compact />}
              </div>
            )}
          </div>
        </section>
      )}

      {showStudyCard && current && (
        <Modal onClose={() => setShowStudyCard(false)} className="study-card-modal">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Study card</h2>
            <span className="badge score-badge">
              Score {scoreRight}✓ / {scoreWrong}✗
              {formatAvgResponse(current) && ` · ${formatAvgResponse(current)}`}
            </span>
          </div>

          <div className="study-lemma">
            <div className="study-lemma-main entry-lemma">
              <div className="hanzi-xl">{current.hanzi}</div>
              <div className="pinyin-lg">{current.pinyin}</div>
              <div className="study-english">{current.english}</div>
            </div>
            <SpeakButton hanzi={current.hanzi} citationTones={toneMode} />
          </div>

          {toneMode && (
            <div className="stack" style={{ gap: '0.5rem' }}>
              <div className="tone-reveal-pair">
                <div className="tone-reveal-col">
                  <div className="tone-reveal-label">Citation</div>
                  <div className="tone-reveal-visual" style={{ alignSelf: 'center' }}>
                    <ToneContour tones={tonesFromPinyin(current.pinyin)} size="md" />
                  </div>
                </div>
                {sandhiSpokenTones(current) && (
                  <div className="tone-reveal-col">
                    <div className="tone-reveal-label">Spoken</div>
                    <div className="tone-reveal-visual" style={{ alignSelf: 'center' }}>
                      <ToneContour tones={sandhiSpokenTones(current)!} size="md" />
                    </div>
                  </div>
                )}
              </div>
              {sandhiNoteFor(current) && (
                <div className="tone-sandhi-note">{sandhiNoteFor(current)}</div>
              )}
            </div>
          )}

          <div className="row">
            <HskBadge hsk={current.hsk} />
            <span className="badge">{current.type}</span>
            {current.topics.map((t) => (
              <span key={t} className="chip chip-static">
                {t}
              </span>
            ))}
          </div>

          <ExtraDetailPanel entry={current} />

          <CollapsibleSection title="Your notes" hasContent={Boolean(notesDraft.trim())}>
            <label className="field">
              <span className="sr-only">Your notes</span>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                onBlur={() => void saveUserNotes()}
                placeholder="Personal reminders…"
                rows={2}
              />
            </label>
          </CollapsibleSection>

          <div className="study-card-footer">
            <button
              type="button"
              className="btn btn-primary study-got-it-btn"
              onClick={() => {
                void saveUserNotes();
                setShowStudyCard(false);
                nextCard();
              }}
            >
              {index + 1 >= queue.length ? 'Finish' : 'Got it'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
