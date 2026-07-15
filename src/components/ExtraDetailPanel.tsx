import { useState } from 'react';
import { db } from '../db/schema';
import { regenerateTeachingNote } from '../lib/gemini';
import { getApiKey } from '../lib/settings';
import type { VocabEntry } from '../types';
import { CollapsibleSection } from './CollapsibleSection';

type Props = {
  entry: VocabEntry;
  onUpdated?: (patch: Partial<VocabEntry>) => void;
};

type NoteKind = 'extra' | 'hanzi';

export function ExtraDetailPanel({ entry, onUpdated }: Props) {
  const [busyKind, setBusyKind] = useState<NoteKind | null>(null);
  const [error, setError] = useState('');

  async function persist(patch: Partial<VocabEntry>) {
    if (entry.id == null) return;
    await db.entries.update(entry.id, { ...patch, updatedAt: Date.now() });
    onUpdated?.(patch);
  }

  async function getNewNote(kind: NoteKind, ratingHint: -1 | 0 | 1 = 0) {
    setError('');
    if (!getApiKey()) {
      setError('Add your Gemini API key in Settings first.');
      return;
    }
    // Never overwrite a tip the learner upvoted.
    if (kind === 'extra' && entry.extraDetailRating === 1) {
      setError('Unvote the tip before regenerating.');
      return;
    }
    if (kind === 'hanzi' && entry.hanziDetailRating === 1) {
      setError('Unvote the tip before regenerating.');
      return;
    }
    setBusyKind(kind);
    try {
      if (kind === 'extra') {
        const rejected = [...(entry.rejectedDetails || [])];
        if (entry.extraDetail.trim() && ratingHint !== 1) {
          if (!rejected.includes(entry.extraDetail.trim())) {
            rejected.push(entry.extraDetail.trim());
          }
        }
        const text = await regenerateTeachingNote({
          ...entry,
          kind: 'extra',
          currentNote: entry.extraDetail,
          rating: ratingHint || entry.extraDetailRating,
          rejectedDetails: rejected,
        });
        await persist({
          extraDetail: text,
          extraDetailRating: 0,
          rejectedDetails: rejected.slice(-20),
        });
      } else {
        const rejected = [...(entry.rejectedHanziDetails || [])];
        if (entry.hanziDetail?.trim() && ratingHint !== 1) {
          if (!rejected.includes(entry.hanziDetail.trim())) {
            rejected.push(entry.hanziDetail.trim());
          }
        }
        const text = await regenerateTeachingNote({
          ...entry,
          kind: 'hanzi',
          currentNote: entry.hanziDetail || '',
          rating: ratingHint || entry.hanziDetailRating || 0,
          rejectedDetails: rejected,
        });
        await persist({
          hanziDetail: text,
          hanziDetailRating: 0,
          rejectedHanziDetails: rejected.slice(-20),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate a new tip.');
    } finally {
      setBusyKind(null);
    }
  }

  async function rate(kind: NoteKind, rating: -1 | 1) {
    setError('');
    if (kind === 'extra') {
      const next: -1 | 0 | 1 = entry.extraDetailRating === rating ? 0 : rating;
      const patch: Partial<VocabEntry> = { extraDetailRating: next };
      if (rating === -1 && next === -1 && entry.extraDetail.trim()) {
        const rejected = [...(entry.rejectedDetails || [])];
        if (!rejected.includes(entry.extraDetail.trim())) {
          rejected.push(entry.extraDetail.trim());
        }
        patch.rejectedDetails = rejected.slice(-20);
      }
      await persist(patch);
      // Bad tip → try again (pattern builds slowly from ups/downs)
      if (rating === -1 && next === -1 && getApiKey()) {
        await getNewNote('extra', -1);
      }
      return;
    }
    const next: -1 | 0 | 1 = entry.hanziDetailRating === rating ? 0 : rating;
    const patch: Partial<VocabEntry> = { hanziDetailRating: next };
    if (rating === -1 && next === -1 && entry.hanziDetail?.trim()) {
      const rejected = [...(entry.rejectedHanziDetails || [])];
      if (!rejected.includes(entry.hanziDetail.trim())) {
        rejected.push(entry.hanziDetail.trim());
      }
      patch.rejectedHanziDetails = rejected.slice(-20);
    }
    await persist(patch);
    if (rating === -1 && next === -1 && getApiKey()) {
      await getNewNote('hanzi', -1);
    }
  }

  function NoteBody({
    kind,
    text,
    rating,
  }: {
    kind: NoteKind;
    text: string;
    rating: -1 | 0 | 1;
  }) {
    return (
      <div className="tip-row">
        <div className="tip-body">
          {text.trim() ? (
            <p className="extra-detail-text">{text.trim()}</p>
          ) : (
            <p className="extra-detail-text tip-empty muted">No tip yet.</p>
          )}
        </div>

        <div className="tip-actions">
          <div className="tip-votes" aria-label="Rate tip">
            <button
              type="button"
              className={`rate-btn ${rating === 1 ? 'active-up' : ''}`}
              onClick={() => void rate(kind, 1)}
              title="Keep this tip"
              aria-label="Rate tip up"
            >
              ▲
            </button>
            <button
              type="button"
              className={`rate-btn ${rating === -1 ? 'active-down' : ''}`}
              onClick={() => void rate(kind, -1)}
              title="This one’s bad"
              aria-label="Rate tip down"
            >
              ▼
            </button>
          </div>
          <button
            type="button"
            className="tip-regen"
            disabled={busyKind != null || rating === 1}
            onClick={() => void getNewNote(kind, rating === -1 ? -1 : 0)}
            title={
              rating === 1
                ? 'Unvote before regenerating — upvoted tips are kept'
                : 'Regenerate tip'
            }
          >
            {busyKind === kind ? '…' : 'Regenerate tip'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: '0.55rem' }}>
      <CollapsibleSection title="Grammar tip" hasContent={Boolean(entry.extraDetail?.trim())}>
        <NoteBody
          kind="extra"
          text={entry.extraDetail || ''}
          rating={entry.extraDetailRating || 0}
        />
      </CollapsibleSection>

      {entry.type !== 'sentence' && (
        <CollapsibleSection title="Character tip" hasContent={Boolean(entry.hanziDetail?.trim())}>
          <NoteBody
            kind="hanzi"
            text={entry.hanziDetail || ''}
            rating={entry.hanziDetailRating || 0}
          />
        </CollapsibleSection>
      )}

      {error && <div className="alert alert-error">{error}</div>}
    </div>
  );
}
