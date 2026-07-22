import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../db/schema';
import type { HskLevel, Topic, VocabEntry } from '../types';
import { HskBadge, TopicChips } from '../components/Badges';
import { EntryEditor } from '../components/EntryEditor';
import { ExtraDetailPanel } from '../components/ExtraDetailPanel';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { Modal } from '../components/Modal';
import { SpeakButton } from '../components/SpeakButton';
import { matchesSearch } from '../lib/pinyin';

const HSK_FILTERS: Array<HskLevel | 'all'> = ['all', 1, 2, 3, 'unknown'];

/** Saved sentences — rehearsed in Forms, not flashcarded on Tend. */
export function LinesPage() {
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [query, setQuery] = useState('');
  const [topics, setTopics] = useState<Set<Topic>>(new Set());
  const [hsk, setHsk] = useState<HskLevel | 'all'>('all');
  const [selected, setSelected] = useState<VocabEntry | null>(null);
  const [editing, setEditing] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');

  useEffect(() => {
    const sub = liveQuery(() => db.entries.toArray()).subscribe({
      next: (rows) => {
        const seen = new Set<string>();
        const unique = rows
          .filter((e) => e.type === 'sentence')
          .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
          .filter((e) => {
            const key = e.hanzi.replace(/\s+/g, '');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort((a, b) => a.hanzi.localeCompare(b.hanzi, 'zh'));
        setEntries(unique);
      },
      error: console.error,
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    if (selected) {
      setNotesDraft(selected.notes);
      setEditing(false);
    }
  }, [selected?.id]);

  useEffect(() => {
    setSelected((prev) => {
      if (!prev?.id) return prev;
      const fresh = entries.find((e) => e.id === prev.id);
      if (!fresh) {
        setEditing(false);
        return null;
      }
      return fresh;
    });
  }, [entries]);

  useEffect(() => {
    if (!selected?.id) return;
    if (notesDraft === selected.notes) return;
    const timer = window.setTimeout(() => {
      const id = selected.id!;
      void db.entries.update(id, { notes: notesDraft, updatedAt: Date.now() });
      setSelected((prev) => (prev?.id === id ? { ...prev, notes: notesDraft } : prev));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [notesDraft, selected?.id, selected?.notes]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (hsk !== 'all' && e.hsk !== hsk) return false;
      if (topics.size > 0 && !e.topics.some((t) => topics.has(t))) return false;
      return matchesSearch(e, query);
    });
  }, [entries, query, topics, hsk]);

  /** Only topics that have at least one line. */
  const allTopics = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      for (const t of e.topics) {
        if (t.trim()) set.add(t);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [entries]);

  useEffect(() => {
    setTopics((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((t) => allTopics.includes(t)));
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [allTopics]);

  function toggleTopic(topic: Topic) {
    setTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  }

  async function deleteSelected() {
    if (!selected?.id) return;
    if (!confirm(`Delete “${selected.hanzi}”?`)) return;
    await db.entries.delete(selected.id);
    setSelected(null);
    setEditing(false);
  }

  async function saveSelected(patch: {
    hanzi: string;
    pinyin: string;
    english: string;
    type: VocabEntry['type'];
    hsk: HskLevel;
    topics: Topic[];
  }) {
    if (!selected?.id) return;
    await db.entries.update(selected.id, { ...patch, updatedAt: Date.now() });
    setSelected({ ...selected, ...patch });
    setEditing(false);
  }

  return (
    <div className="stack">
      <header className="page-header">
        <h1>
          Lines <span className="page-title-zh">例句</span>
        </h1>
        <p>
          Sentences you keep — use them in Forms Level 2. They don’t sit on the Shelf or go through
          Tend.
        </p>
      </header>

      <section className="panel stack library-filters">
        <label className="field">
          Search
          <input
            type="search"
            placeholder="Search sentences…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        {allTopics.length > 0 && (
          <div>
            <div className="muted" style={{ marginBottom: '0.45rem', fontSize: '0.85rem', fontWeight: 600 }}>
              Topics
            </div>
            <TopicChips topics={allTopics} active={topics} onToggle={toggleTopic} />
          </div>
        )}

        <div className="row">
          <span className="muted" style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            HSK
          </span>
          {HSK_FILTERS.map((level) => (
            <button
              key={String(level)}
              type="button"
              className={`chip ${hsk === level ? 'active' : ''}`}
              onClick={() => setHsk(level)}
            >
              {level === 'all' ? 'All' : level === 'unknown' ? '?' : level}
            </button>
          ))}
        </div>

        <div className="muted">
          {filtered.length} of {entries.length} lines
        </div>
      </section>

      {filtered.length === 0 ? (
        <div className="panel empty">
          {entries.length === 0
            ? 'No sentences yet — Gather some, or save them from Temper / Forms.'
            : 'No matches.'}
        </div>
      ) : (
        <div className="entry-grid">
          {filtered.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="entry-card entry-card-sentence"
              onClick={() => setSelected(entry)}
            >
              <div className="hanzi">{entry.hanzi}</div>
              <div className="pinyin">{entry.pinyin}</div>
              <div className="english">{entry.english}</div>
              <div className="meta">
                <HskBadge hsk={entry.hsk} />
                <span className="badge">sentence</span>
                {entry.topics.slice(0, 2).map((t) => (
                  <span key={t} className="chip chip-static">
                    {t}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <Modal
          onClose={() => {
            setSelected(null);
            setEditing(false);
          }}
          className="entry-detail-modal"
        >
          {!editing && (
            <div className="entry-modal-edit">
              <button
                type="button"
                className="btn btn-secondary entry-edit-btn"
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
            </div>
          )}
          <div className="entry-modal-speak">
            <SpeakButton hanzi={selected.hanzi} compact />
          </div>

          {editing ? (
            <EntryEditor
              entry={selected}
              knownTopics={allTopics}
              lockSentence
              onSave={saveSelected}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <div className="entry-lemma">
                <div className="hanzi-xl hanzi-xl-sentence">{selected.hanzi}</div>
                <div className="pinyin-lg">{selected.pinyin}</div>
                <div className="english-lg">{selected.english}</div>
              </div>
              <div className="row">
                <HskBadge hsk={selected.hsk} />
                <span className="badge">sentence</span>
                {selected.topics.map((t) => (
                  <span key={t} className="chip chip-static">
                    {t}
                  </span>
                ))}
              </div>

              <ExtraDetailPanel
                entry={selected}
                onUpdated={(patch) => setSelected({ ...selected, ...patch })}
              />

              <CollapsibleSection title="Your notes" hasContent={Boolean(notesDraft.trim())}>
                <label className="field">
                  <span className="sr-only">Your notes</span>
                  <textarea
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder="Personal reminders…"
                  />
                </label>
              </CollapsibleSection>

              <div className="entry-modal-footer">
                <button
                  type="button"
                  className="btn btn-primary entry-close-btn"
                  onClick={() => {
                    setSelected(null);
                    setEditing(false);
                  }}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="entry-delete-btn"
                  onClick={() => void deleteSelected()}
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
