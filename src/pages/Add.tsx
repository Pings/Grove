import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { enrichInput } from '../lib/gemini';
import { toPinyin } from '../lib/pinyin';
import { db, normalizeHanzi, upsertEntry } from '../db/schema';
import { TOPICS, type EnrichResult, type EntryType, type HskLevel, type Topic, type VocabEntry } from '../types';
import { getApiKey } from '../lib/settings';

type DraftItem = {
  key: string;
  hanzi: string;
  english: string;
  type: EntryType;
  topics: Topic[];
  hsk: HskLevel;
  notes: string;
  include: boolean;
  isPrimary: boolean;
};

function toDrafts(result: EnrichResult, existingHanzi: Set<string>): DraftItem[] {
  const make = (
    hanzi: string,
    english: string,
    type: EntryType,
    topics: Topic[],
    hsk: HskLevel,
    notes: string,
    key: string,
    isPrimary: boolean,
  ): DraftItem => {
    const duplicate = existingHanzi.has(normalizeHanzi(hanzi));
    return {
      key,
      hanzi,
      english,
      type,
      topics,
      hsk,
      notes,
      include: !duplicate,
      isPrimary,
    };
  };

  const primary = make(
    result.hanzi,
    result.english,
    result.type,
    result.topics,
    result.hsk,
    result.notes ?? '',
    `primary-${result.hanzi}`,
    true,
  );

  const components = result.components
    .filter((c) => c.hanzi !== result.hanzi)
    .map((c, i) =>
      make(
        c.hanzi,
        c.english,
        c.type,
        c.topics,
        c.hsk,
        c.notes ?? '',
        `comp-${i}-${c.hanzi}`,
        false,
      ),
    );

  return [primary, ...components];
}

export function AddPage() {
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [input, setInput] = useState('');
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [addingTopicFor, setAddingTopicFor] = useState<string | null>(null);
  const [newTopicText, setNewTopicText] = useState('');

  useEffect(() => {
    const sub = liveQuery(() => db.entries.toArray()).subscribe({
      next: setEntries,
      error: console.error,
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    const onInsert = (event: Event) => {
      const hanzi = (event as CustomEvent<{ hanzi?: string }>).detail?.hanzi?.trim();
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

  const existingHanzi = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      if (e.hanzi.trim()) set.add(normalizeHanzi(e.hanzi));
    }
    return set;
  }, [entries]);

  const isDuplicate = (hanzi: string) =>
    hanzi.trim().length > 0 && existingHanzi.has(normalizeHanzi(hanzi));

  const knownTopics = useMemo(() => {
    const set = new Set<string>([...TOPICS]);
    for (const d of drafts) {
      for (const t of d.topics) set.add(t);
    }
    return [...set];
  }, [drafts]);

  const duplicateCount = useMemo(
    () => drafts.filter((d) => isDuplicate(d.hanzi)).length,
    [drafts, existingHanzi],
  );

  async function handleEnrich() {
    setError('');
    setSavedMsg('');
    if (!input.trim()) {
      setError('Type a Chinese or English word, phrase, or sentence.');
      return;
    }
    if (!getApiKey()) {
      setError('Add your Gemini API key in Settings first.');
      return;
    }
    setLoading(true);
    try {
      const result = await enrichInput(input.trim());
      if (!result.hanzi || !result.english) {
        throw new Error('Gemini returned an incomplete result. Try again.');
      }
      setDrafts(toDrafts(result, existingHanzi));
      setAddingTopicFor(null);
      setNewTopicText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enrichment failed.');
    } finally {
      setLoading(false);
    }
  }

  function updateDraft(key: string, patch: Partial<DraftItem>) {
    setDrafts((rows) =>
      rows.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        if (patch.hanzi != null && isDuplicate(patch.hanzi)) {
          next.include = false;
        }
        return next;
      }),
    );
  }

  function removeTopic(key: string, topic: Topic) {
    setDrafts((rows) =>
      rows.map((r) =>
        r.key === key ? { ...r, topics: r.topics.filter((t) => t !== topic) } : r,
      ),
    );
  }

  function addTopic(key: string, topic: string) {
    const cleaned = topic.trim();
    if (!cleaned) return;
    setDrafts((rows) =>
      rows.map((r) => {
        if (r.key !== key) return r;
        if (r.topics.includes(cleaned)) return r;
        return { ...r, topics: [...r.topics, cleaned] };
      }),
    );
  }

  function submitNewTopic(key: string) {
    addTopic(key, newTopicText);
    setNewTopicText('');
    setAddingTopicFor(null);
  }

  async function handleSave() {
    setError('');
    const selected = drafts.filter((d) => d.include && d.hanzi.trim() && d.english.trim());
    if (selected.length === 0) {
      setError('Select at least one new entry to save.');
      return;
    }

    const toSave = selected.filter((d) => !isDuplicate(d.hanzi));
    const skipped = selected.length - toSave.length;

    if (toSave.length === 0) {
      setError(
        skipped === 1
          ? 'That entry is already in your library.'
          : `All ${skipped} selected entries are already in your library.`,
      );
      return;
    }

    for (const item of toSave) {
      await upsertEntry({
        hanzi: item.hanzi.trim(),
        pinyin: toPinyin(item.hanzi.trim()),
        english: item.english.trim(),
        type: item.type,
        topics: item.topics.length ? item.topics : ['Other'],
        hsk: item.hsk,
        notes: '',
        status: 'learning',
      });
    }

    let msg = `Saved ${toSave.length} entr${toSave.length === 1 ? 'y' : 'ies'}.`;
    if (skipped > 0) {
      msg += ` ${skipped} already in library — skipped.`;
    }
    setSavedMsg(msg);
    setDrafts([]);
    setInput('');
  }

  const unusedTopics = (draft: DraftItem) =>
    knownTopics.filter((t) => !draft.topics.includes(t));

  const savableCount = drafts.filter(
    (d) => d.include && d.hanzi.trim() && d.english.trim() && !isDuplicate(d.hanzi),
  ).length;

  return (
    <div className="stack">
      <header className="page-header">
        <h1>
          Gather <span className="page-title-zh">采词</span>
        </h1>
        <p>
          Bring new words into the garden — or full sentences into Lines. Paste English or Chinese —
          Gemini tends the rest.
        </p>
      </header>

      <section className="panel stack">
        <label className="field">
          Word, phrase, or sentence
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="明天我去学校 · I go to school tomorrow"
          />
        </label>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={handleEnrich} disabled={loading}>
            {loading ? 'Working…' : 'Translate & organise'}
          </button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        {savedMsg && <div className="alert alert-info">{savedMsg}</div>}
      </section>

      {drafts.length > 0 && (
        <section className="stack">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>Review before saving</h2>
            {duplicateCount > 0 && (
              <span className="muted" style={{ fontSize: '0.9rem' }}>
                {duplicateCount} already in library
              </span>
            )}
          </div>
          {drafts.map((draft) => {
            const duplicate = isDuplicate(draft.hanzi);
            return (
              <div
                key={draft.key}
                className={`add-review-card ${draft.include && !duplicate ? '' : 'add-review-skipped'} ${duplicate ? 'add-review-duplicate' : ''}`}
              >
                <div className="add-review-top">
                  <button
                    type="button"
                    className={`add-include-check ${draft.include && !duplicate ? 'checked' : ''}`}
                    aria-pressed={draft.include && !duplicate}
                    aria-label={
                      duplicate
                        ? 'Already in library'
                        : draft.include
                          ? 'Included — click to skip'
                          : 'Skipped — click to include'
                    }
                    title={duplicate ? 'Already in library' : draft.include ? 'Include' : 'Skip'}
                    disabled={duplicate}
                    onClick={() => {
                      if (!duplicate) updateDraft(draft.key, { include: !draft.include });
                    }}
                  >
                    {draft.include && !duplicate ? '✓' : ''}
                  </button>
                  <span className="add-review-kind muted">
                    {draft.isPrimary ? 'Main entry' : 'New word'}
                  </span>
                  {duplicate && <span className="badge badge-duplicate">Already added</span>}
                  <div className="add-review-meta-inline">
                    <select
                      className="add-meta-select"
                      value={draft.type}
                      onChange={(e) =>
                        updateDraft(draft.key, { type: e.target.value as EntryType })
                      }
                      aria-label="Type"
                    >
                      <option value="word">word</option>
                      <option value="phrase">phrase</option>
                      <option value="sentence">sentence</option>
                    </select>
                    <select
                      className="add-meta-select"
                      value={String(draft.hsk)}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateDraft(draft.key, {
                          hsk: v === 'unknown' ? 'unknown' : (Number(v) as 1 | 2 | 3),
                        });
                      }}
                      aria-label="HSK (Gemini educated guess — edit if wrong)"
                    >
                      <option value="1">HSK 1</option>
                      <option value="2">HSK 2</option>
                      <option value="3">HSK 3</option>
                      <option value="unknown">HSK ?</option>
                    </select>
                  </div>
                </div>

                <label className="add-focus-field">
                  <span className="sr-only">Hanzi</span>
                  <input
                    type="text"
                    className="add-hanzi-input"
                    value={draft.hanzi}
                    onChange={(e) => updateDraft(draft.key, { hanzi: e.target.value })}
                    placeholder="汉字"
                  />
                </label>

                <div className="add-pinyin-display">{toPinyin(draft.hanzi) || '—'}</div>

                <label className="add-focus-field">
                  <span className="sr-only">English</span>
                  <input
                    type="text"
                    className="add-english-input"
                    value={draft.english}
                    onChange={(e) => updateDraft(draft.key, { english: e.target.value })}
                    placeholder="English meaning"
                  />
                </label>

                <div className="add-topics-row">
                  {draft.topics.map((topic) => (
                    <button
                      key={topic}
                      type="button"
                      className="chip active add-topic-chip"
                      onClick={() => removeTopic(draft.key, topic)}
                      title="Remove topic"
                    >
                      {topic}
                      <span className="add-topic-x" aria-hidden>
                        ×
                      </span>
                    </button>
                  ))}

                  {addingTopicFor === draft.key ? (
                    <div className="add-topic-new">
                      <input
                        type="text"
                        list={`topics-${draft.key}`}
                        value={newTopicText}
                        onChange={(e) => setNewTopicText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            submitNewTopic(draft.key);
                          }
                          if (e.key === 'Escape') {
                            setAddingTopicFor(null);
                            setNewTopicText('');
                          }
                        }}
                        placeholder="Topic name"
                        autoFocus
                      />
                      <datalist id={`topics-${draft.key}`}>
                        {unusedTopics(draft).map((t) => (
                          <option key={t} value={t} />
                        ))}
                      </datalist>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '0.35rem 0.65rem' }}
                        onClick={() => submitNewTopic(draft.key)}
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '0.35rem 0.65rem' }}
                        onClick={() => {
                          setAddingTopicFor(null);
                          setNewTopicText('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="chip add-topic-add"
                      onClick={() => {
                        setAddingTopicFor(draft.key);
                        setNewTopicText('');
                      }}
                    >
                      + topic
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={savableCount === 0}
            >
              Save selected{savableCount > 0 ? ` (${savableCount})` : ''}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setDrafts([])}>
              Discard
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
