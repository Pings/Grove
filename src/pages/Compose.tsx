import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, upsertEntry } from '../db/schema';
import { composeWithLearned } from '../lib/gemini';
import { findRelatedEntries, toPinyin } from '../lib/pinyin';
import { getApiKey, getLearnedAvgMs } from '../lib/settings';
import { isPerformanceLearned } from '../lib/flashcards';
import type { ComposeResult, VocabEntry } from '../types';
import { HskBadge } from '../components/Badges';
import { isGrowthDemoEntry } from '../data/growthDemos';

export function ComposePage() {
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [showFix, setShowFix] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const deferredInput = useDeferredValue(input);

  useEffect(() => {
    const sub = liveQuery(() => db.entries.toArray()).subscribe({
      next: setEntries,
      error: console.error,
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    const onInsert = (event: Event) => {
      const detail = (event as CustomEvent<{ hanzi?: string; english?: string }>).detail;
      const hanzi = detail?.hanzi?.trim();
      if (!hanzi) return;
      setInput((prev) => {
        const trimmed = prev.trimEnd();
        if (!trimmed) return hanzi;
        return `${trimmed}${/[\u4e00-\u9fff]$/.test(trimmed) ? '' : ' '}${hanzi}`;
      });
    };
    window.addEventListener('hanzi-board:insert', onInsert);
    return () => window.removeEventListener('hanzi-board:insert', onInsert);
  }, []);

  // Library words/phrases are your known vocabulary (seed + anything you add).
  const learned = useMemo(
    () =>
      entries.filter(
        (e) => (e.type === 'word' || e.type === 'phrase') && !isGrowthDemoEntry(e),
      ),
    [entries],
  );

  const liveMatches = useMemo(
    () => findRelatedEntries(entries, deferredInput, 24),
    [entries, deferredInput],
  );

  async function handleCompose() {
    setError('');
    setSavedMsg('');
    setResult(null);
    setShowFix(false);
    if (!input.trim()) {
      setError('Type English or Chinese to check.');
      return;
    }
    if (!getApiKey()) {
      setError('Add your Gemini API key in Settings first.');
      return;
    }
    setLoading(true);
    try {
      const vocab = learned.map((e) => ({
        hanzi: e.hanzi,
        pinyin: e.pinyin,
        english: e.english,
      }));
      const data = await composeWithLearned(input.trim(), vocab);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compose failed.');
    } finally {
      setLoading(false);
    }
  }

  async function addUnknown(word: ComposeResult['unknownWords'][number]) {
    await upsertEntry({
      hanzi: word.hanzi,
      pinyin: word.pinyin || toPinyin(word.hanzi),
      english: word.english || word.hanzi,
      type: word.type,
      topics: word.topics,
      hsk: word.hsk,
      notes: '',
      status: 'learning',
    });
    setSavedMsg(`Added ${word.hanzi} to your library.`);
  }

  function insertEntry(entry: VocabEntry) {
    setInput((prev) => {
      const trimmed = prev.trimEnd();
      if (!trimmed) return entry.hanzi;
      const last = trimmed.slice(-1);
      const useEnglish = /[a-zA-Z]/.test(last) && !/[\u4e00-\u9fff]/.test(trimmed);
      const piece = useEnglish ? entry.english : entry.hanzi;
      return `${trimmed}${/[\u4e00-\u9fff]$/.test(trimmed) ? '' : ' '}${piece}`;
    });
  }

  function useSuggestedFix() {
    if (!result?.translation) return;
    setInput(result.translation);
    setShowFix(false);
    setResult(null);
    setSavedMsg('Copied the suggested fix into the box — edit it, then Check again.');
  }

  return (
    <div className="stack">
      <header className="page-header">
        <h1>
          Temper <span className="page-title-zh">炼句</span>
        </h1>
        <p>
          Write a line, get feedback, then fix it yourself. English → Chinese draft, or Chinese →
          check without auto-replacing your sentence.
        </p>
      </header>

      <section className="panel stack">
        <label className="field">
          English or Chinese
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="I want to go to the park tomorrow · 明天我想去公园"
          />
        </label>
        <div className="muted">Using {learned.length} library words/phrases as reference.</div>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleCompose}
            disabled={loading}
          >
            {loading ? 'Checking…' : 'Check'}
          </button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        {savedMsg && <div className="alert alert-info">{savedMsg}</div>}
      </section>

      {input.trim() && (
        <section className="stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>
              In your library
            </h2>
            <span className="muted">
              {liveMatches.length} match{liveMatches.length === 1 ? '' : 'es'}
            </span>
          </div>

          {liveMatches.length === 0 ? (
            <div className="panel empty" style={{ padding: '1.25rem' }}>
              No matching cards yet — keep typing, or check to find new words.
            </div>
          ) : (
            <div className="entry-grid">
              {liveMatches.map((entry) => {
                const learnedMark = isPerformanceLearned(entry, getLearnedAvgMs());
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={`entry-card ${learnedMark ? 'learned' : ''}`}
                    onClick={() => insertEntry(entry)}
                    title="Click to insert"
                  >
                    <div className="hanzi">{entry.hanzi}</div>
                    <div className="pinyin">{entry.pinyin}</div>
                    <div className="english">{entry.english}</div>
                    <div className="meta">
                      <HskBadge hsk={entry.hsk} />
                      <span className="badge">{entry.type}</span>
                      {entry.topics.slice(0, 2).map((t) => (
                        <span key={t} className="chip chip-static">
                          {t}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {result && (
        <section className="panel stack">
          {result.mode === 'check' ? (
            <>
              <div
                className={`alert ${result.ok ? 'alert-info' : 'alert-warn'}`}
                style={{ margin: 0 }}
              >
                {result.ok
                  ? 'Looks good — keep going, or polish if you want.'
                  : 'Not quite — see why below, then edit your sentence and Check again.'}
              </div>

              {result.meaning && (
                <div>
                  <div className="muted" style={{ fontWeight: 600, marginBottom: '0.35rem' }}>
                    Meaning (of what you wrote)
                  </div>
                  <div style={{ fontSize: '1.15rem', lineHeight: 1.45 }}>{result.meaning}</div>
                </div>
              )}

              {result.notes && (
                <div>
                  <div className="muted" style={{ fontWeight: 600, marginBottom: '0.35rem' }}>
                    Feedback
                  </div>
                  <div style={{ lineHeight: 1.5 }}>{result.notes}</div>
                </div>
              )}

              {!result.ok && result.translation && (
                <div className="stack" style={{ gap: '0.45rem' }}>
                  {!showFix ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setShowFix(true)}
                    >
                      Stuck? Reveal a corrected version
                    </button>
                  ) : (
                    <>
                      <div className="muted" style={{ fontWeight: 600 }}>
                        One possible fix
                      </div>
                      <div className="hanzi-xl">{result.translation}</div>
                      <div className="pinyin-lg">{toPinyin(result.translation)}</div>
                      <div className="row">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={useSuggestedFix}
                        >
                          Put in box to edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setShowFix(false)}
                        >
                          Hide
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <div className="muted" style={{ fontWeight: 600, marginBottom: '0.35rem' }}>
                  Chinese draft
                </div>
                <div className="hanzi-xl">{result.translation}</div>
                {result.translation && (
                  <div className="pinyin-lg">{toPinyin(result.translation)}</div>
                )}
              </div>
              {result.meaning && (
                <div>
                  <div className="muted" style={{ fontWeight: 600, marginBottom: '0.35rem' }}>
                    Meaning
                  </div>
                  <div style={{ fontSize: '1.15rem', lineHeight: 1.45 }}>{result.meaning}</div>
                </div>
              )}
              {result.notes && <div className="muted">{result.notes}</div>}
              {result.translation && (
                <button type="button" className="btn btn-secondary" onClick={useSuggestedFix}>
                  Put in box to practise / edit
                </button>
              )}
            </>
          )}

          <div className={`alert ${result.usedOnlyLearned ? 'alert-info' : 'alert-warn'}`}>
            {result.usedOnlyLearned
              ? 'Stayed within your learned / library vocabulary.'
              : 'Needed some words outside your current list — see below.'}
          </div>

          {result.unknownWords.length > 0 && (
            <div className="stack">
              <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>
                New words to consider
              </h2>
              {result.unknownWords.map((word) => (
                <div key={word.hanzi} className="checkbox-row" style={{ alignItems: 'center' }}>
                  <div className="grow">
                    <div
                      style={{ fontFamily: 'var(--font-zh)', fontSize: '1.3rem', fontWeight: 400 }}
                    >
                      {word.hanzi}
                    </div>
                    <div className="pinyin-lg" style={{ fontSize: '0.95rem' }}>
                      {word.pinyin || toPinyin(word.hanzi)}
                    </div>
                    <div className="muted">{word.english}</div>
                    <div className="row" style={{ marginTop: '0.35rem' }}>
                      <HskBadge hsk={word.hsk} />
                      <span className="badge">{word.type}</span>
                      {word.topics.map((t) => (
                        <span key={t} className="chip chip-static">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void addUnknown(word)}
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
