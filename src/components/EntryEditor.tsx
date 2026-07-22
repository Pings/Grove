import { useMemo, useState } from 'react';
import { TOPICS, type EntryType, type HskLevel, type Topic, type VocabEntry } from '../types';
import { toPinyin } from '../lib/pinyin';

type Draft = {
  hanzi: string;
  english: string;
  type: EntryType;
  hsk: HskLevel;
  topics: Topic[];
};

type Props = {
  entry: VocabEntry;
  /** Extra topic suggestions (e.g. topics already used in the library). */
  knownTopics?: string[];
  /** When true, type is locked to sentence (Lines). */
  lockSentence?: boolean;
  onSave: (patch: {
    hanzi: string;
    pinyin: string;
    english: string;
    type: EntryType;
    hsk: HskLevel;
    topics: Topic[];
  }) => void | Promise<void>;
  onCancel: () => void;
};

function toDraft(entry: VocabEntry): Draft {
  return {
    hanzi: entry.hanzi,
    english: entry.english,
    type: entry.type,
    hsk: entry.hsk,
    topics: [...entry.topics],
  };
}

export function EntryEditor({
  entry,
  knownTopics = [],
  lockSentence = false,
  onSave,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(entry));
  const [addingTopic, setAddingTopic] = useState(false);
  const [newTopicText, setNewTopicText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const topicChoices = useMemo(() => {
    const set = new Set<string>([...TOPICS, ...knownTopics, ...draft.topics]);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [knownTopics, draft.topics]);

  const unusedTopics = topicChoices.filter((t) => !draft.topics.includes(t));

  function removeTopic(topic: Topic) {
    setDraft((d) => ({ ...d, topics: d.topics.filter((t) => t !== topic) }));
  }

  function addTopic(topic: string) {
    const cleaned = topic.trim();
    if (!cleaned) return;
    setDraft((d) =>
      d.topics.includes(cleaned) ? d : { ...d, topics: [...d.topics, cleaned] },
    );
  }

  function submitNewTopic() {
    addTopic(newTopicText);
    setNewTopicText('');
    setAddingTopic(false);
  }

  async function handleSave() {
    setError('');
    const hanzi = draft.hanzi.trim();
    const english = draft.english.trim();
    if (!hanzi || !english) {
      setError('Hanzi and English are required.');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        hanzi,
        pinyin: toPinyin(hanzi),
        english,
        type: lockSentence ? 'sentence' : draft.type,
        hsk: draft.hsk,
        topics: draft.topics.length > 0 ? draft.topics : ['Other'],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setSaving(false);
      return;
    }
    setSaving(false);
  }

  return (
    <div className="entry-editor stack">
      <label className="field">
        Hanzi
        <input
          type="text"
          className="add-hanzi-input"
          value={draft.hanzi}
          onChange={(e) => setDraft((d) => ({ ...d, hanzi: e.target.value }))}
        />
      </label>
      <div className="add-pinyin-display muted">{toPinyin(draft.hanzi) || '—'}</div>

      <label className="field">
        English
        <input
          type="text"
          className="add-english-input"
          value={draft.english}
          onChange={(e) => setDraft((d) => ({ ...d, english: e.target.value }))}
        />
      </label>

      <div className="row entry-editor-meta">
        {!lockSentence && (
          <label className="field">
            Type
            <select
              value={draft.type}
              onChange={(e) =>
                setDraft((d) => ({ ...d, type: e.target.value as EntryType }))
              }
            >
              <option value="word">word</option>
              <option value="phrase">phrase</option>
              <option value="sentence">sentence</option>
            </select>
          </label>
        )}
        <label className="field">
          HSK
          <select
            value={String(draft.hsk)}
            onChange={(e) => {
              const v = e.target.value;
              setDraft((d) => ({
                ...d,
                hsk: v === 'unknown' ? 'unknown' : (Number(v) as 1 | 2 | 3),
              }));
            }}
          >
            <option value="1">HSK 1</option>
            <option value="2">HSK 2</option>
            <option value="3">HSK 3</option>
            <option value="unknown">HSK ?</option>
          </select>
        </label>
      </div>

      <div>
        <div className="muted" style={{ marginBottom: '0.45rem', fontSize: '0.85rem', fontWeight: 600 }}>
          Topics
        </div>
        <div className="add-topics-row">
          {draft.topics.map((topic) => (
            <button
              key={topic}
              type="button"
              className="chip active add-topic-chip"
              onClick={() => removeTopic(topic)}
              title="Remove topic"
            >
              {topic}
              <span className="add-topic-x" aria-hidden>
                ×
              </span>
            </button>
          ))}

          {addingTopic ? (
            <div className="add-topic-new">
              <input
                type="text"
                list="entry-editor-topics"
                value={newTopicText}
                onChange={(e) => setNewTopicText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitNewTopic();
                  }
                  if (e.key === 'Escape') {
                    setAddingTopic(false);
                    setNewTopicText('');
                  }
                }}
                placeholder="Topic name"
                autoFocus
              />
              <datalist id="entry-editor-topics">
                {unusedTopics.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '0.35rem 0.65rem' }}
                onClick={submitNewTopic}
              >
                Add
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '0.35rem 0.65rem' }}
                onClick={() => {
                  setAddingTopic(false);
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
                setAddingTopic(true);
                setNewTopicText('');
              }}
            >
              + topic
            </button>
          )}
        </div>
        {unusedTopics.length > 0 && !addingTopic && (
          <div className="entry-editor-topic-picks row" style={{ marginTop: '0.5rem' }}>
            {unusedTopics.slice(0, 12).map((t) => (
              <button
                key={t}
                type="button"
                className="chip"
                onClick={() => addTopic(t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
