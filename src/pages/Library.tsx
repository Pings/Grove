import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../db/schema';
import type { HskLevel, Topic, VocabEntry } from '../types';
import { HskBadge, TopicChips } from '../components/Badges';
import { EntryEditor } from '../components/EntryEditor';
import { ExtraDetailPanel } from '../components/ExtraDetailPanel';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { GrowthShelf } from '../components/GrowthShelf';
import { EntryPlantBadge, PlantCanopy } from '../components/PlantGrowth';
import { Modal } from '../components/Modal';
import { matchesSearch } from '../lib/pinyin';
import { SpeakButton } from '../components/SpeakButton';
import { formatAvgResponse, isPerformanceLearned } from '../lib/flashcards';
import { growthStage, needsWatering } from '../lib/growth';
import { getLearnedAvgMs } from '../lib/settings';

const HSK_FILTERS: Array<HskLevel | 'all'> = ['all', 1, 2, 3, 'unknown'];
const TYPE_FILTERS = ['all', 'word', 'phrase'] as const;

export function LibraryPage() {
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [query, setQuery] = useState('');
  const [topics, setTopics] = useState<Set<Topic>>(new Set());
  const [hsk, setHsk] = useState<HskLevel | 'all'>('all');
  const [type, setType] = useState<(typeof TYPE_FILTERS)[number]>('all');
  const [selected, setSelected] = useState<VocabEntry | null>(null);
  const [editing, setEditing] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [learnedThresholdMs, setLearnedThresholdMs] = useState(getLearnedAvgMs);

  useEffect(() => {
    const sub = liveQuery(() => db.entries.toArray()).subscribe({
      next: (rows) => {
        const seen = new Set<string>();
        const unique = rows
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
    const syncThreshold = () => setLearnedThresholdMs(getLearnedAvgMs());
    window.addEventListener('focus', syncThreshold);
    window.addEventListener('storage', syncThreshold);
    return () => {
      window.removeEventListener('focus', syncThreshold);
      window.removeEventListener('storage', syncThreshold);
    };
  }, []);

  useEffect(() => {
    if (selected) {
      setNotesDraft(selected.notes);
      setEditing(false);
    }
  }, [selected?.id]);

  // Keep the open card in sync with live DB updates (e.g. after edit).
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

  // Auto-save notes while editing — no Save button.
  useEffect(() => {
    if (!selected?.id) return;
    if (notesDraft === selected.notes) return;
    const timer = window.setTimeout(() => {
      const id = selected.id!;
      void db.entries.update(id, {
        notes: notesDraft,
        updatedAt: Date.now(),
      });
      setSelected((prev) => {
        if (!prev || prev.id !== id) return prev;
        return { ...prev, notes: notesDraft };
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [notesDraft, selected?.id, selected?.notes]);

  const cardEntries = useMemo(
    () => entries.filter((e) => e.type !== 'sentence'),
    [entries],
  );

  const filtered = useMemo(() => {
    return cardEntries.filter((e) => {
      if (hsk !== 'all' && e.hsk !== hsk) return false;
      if (type !== 'all' && e.type !== type) return false;
      if (topics.size > 0 && !e.topics.some((t) => topics.has(t))) return false;
      return matchesSearch(e, query);
    });
  }, [cardEntries, query, topics, hsk, type]);

  /** Only topics that have at least one shelf entry. */
  const allTopics = useMemo(() => {
    const set = new Set<string>();
    for (const e of cardEntries) {
      for (const t of e.topics) {
        if (t.trim()) set.add(t);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [cardEntries]);

  // Drop active filters for topics that no longer have any cards.
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

  function closeSelected() {
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

  const selectedLearned = selected
    ? isPerformanceLearned(selected, learnedThresholdMs)
    : false;
  const avgLabel = selected ? formatAvgResponse(selected) : null;
  const selectedStage = selected ? growthStage(selected, learnedThresholdMs) : 0;

  return (
    <div className="stack">
      <header className="page-header">
        <h1>
          Shelf <span className="page-title-zh">词库</span>
        </h1>
        <p>Words and phrases — sentences live under Lines.</p>
      </header>

      <GrowthShelf
        entries={cardEntries}
        thresholdMs={learnedThresholdMs}
        onSelect={setSelected}
      />

      <section className="panel stack library-filters">
        <label className="field">
          Search
          <input
            type="search"
            placeholder="明天 · mingtian · tomorrow"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
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
          <span className="muted" style={{ fontSize: '0.85rem', fontWeight: 600, marginLeft: '0.5rem' }}>
            Type
          </span>
          {TYPE_FILTERS.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip ${type === t ? 'active' : ''}`}
              onClick={() => setType(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="muted">
          Showing {filtered.length} of {cardEntries.length}
        </div>
      </section>

      {filtered.length === 0 ? (
        <div className="panel empty">No entries match. Try clearing filters or use Gather.</div>
      ) : (
        <div className="entry-grid">
          {filtered.map((entry) => {
            const learned = isPerformanceLearned(entry, learnedThresholdMs);
            const stage = growthStage(entry, learnedThresholdMs);
            const wilted = needsWatering(entry);
            return (
              <button
                key={entry.id}
                type="button"
                className={`entry-card ${learned ? 'learned' : ''} ${wilted ? 'needs-water' : ''}`}
                onClick={() => setSelected(entry)}
              >
                {learned && <PlantCanopy stage={stage} wilted={wilted} />}
                <div className="entry-card-plant" aria-hidden>
                  <EntryPlantBadge
                    entry={entry}
                    stage={stage}
                    thresholdMs={learnedThresholdMs}
                  />
                </div>
                <div className="hanzi">{entry.hanzi}</div>
                <div className="pinyin">{entry.pinyin}</div>
                <div className="english">{entry.english}</div>
                <div className="meta">
                  <HskBadge hsk={entry.hsk} />
                  <span className="badge">{entry.type}</span>
                  {wilted && <span className="badge badge-water">Needs water</span>}
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

      {selected && (
        <Modal onClose={closeSelected} className="entry-detail-modal">
          <div className="entry-modal-speak">
            <SpeakButton hanzi={selected.hanzi} compact />
          </div>

          {editing ? (
            <EntryEditor
              entry={selected}
              knownTopics={allTopics}
              onSave={saveSelected}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <div className="entry-lemma">
                <div className="hanzi-xl">{selected.hanzi}</div>
                <div className="pinyin-lg">{selected.pinyin}</div>
                <div className="english-lg">{selected.english}</div>
              </div>
              <div className="row">
                <HskBadge hsk={selected.hsk} />
                <span className="badge">{selected.type}</span>
                <span className="badge score-badge">
                  {(selected.correctCount ?? 0)}✓ · {(selected.wrongCount ?? 0)}✗
                  {avgLabel ? ` · ${avgLabel}` : ' · no avg yet'}
                </span>
                {selectedLearned && <span className="badge badge-hsk1">Learned</span>}
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
                <div className="entry-modal-plant" aria-hidden>
                  <EntryPlantBadge
                    entry={selected}
                    stage={selectedStage}
                    thresholdMs={learnedThresholdMs}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary entry-close-btn"
                  onClick={closeSelected}
                >
                  Close
                </button>
                <div className="entry-footer-actions">
                  <button
                    type="button"
                    className="entry-text-btn"
                    onClick={() => setEditing(true)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="entry-text-btn entry-delete-btn"
                    onClick={() => void deleteSelected()}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
