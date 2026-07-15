import { useState } from 'react';
import { pronounceHanzi, stopPronouncing } from '../lib/pronounce';

type Props = {
  hanzi: string;
  /** Compact icon-style control for tight layouts. */
  compact?: boolean;
};

function SpeakerIcon({ busy }: { busy: boolean }) {
  return (
    <svg
      className={`speak-icon ${busy ? 'is-busy' : ''}`}
      viewBox="0 0 24 24"
      width="1.15em"
      height="1.15em"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M3.5 9.5v5h3.2L12 19.2V4.8L6.7 9.5H3.5Zm10.2 1.2a2.6 2.6 0 0 1 0 2.6l-1.1-.7a1.3 1.3 0 0 0 0-1.2l1.1-.7Zm1.9-2.4a5.2 5.2 0 0 1 0 7.4l-1.05-.85a3.9 3.9 0 0 0 0-5.7l1.05-.85Zm2-2.3a8.2 8.2 0 0 1 0 12l-1.1-.8a6.9 6.9 0 0 0 0-10.4l1.1-.8Z"
      />
    </svg>
  );
}

export function SpeakButton({ hanzi, compact }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleClick() {
    const text = hanzi.trim();
    if (!text || busy) return;
    setError('');
    setBusy(true);
    try {
      stopPronouncing();
      await pronounceHanzi(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not pronounce.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="speak-wrap">
      <button
        type="button"
        className={`btn btn-secondary speak-btn ${compact ? 'speak-btn-compact' : ''}`}
        onClick={() => void handleClick()}
        disabled={!hanzi.trim() || busy}
        aria-label={busy ? 'Playing pronunciation' : 'Pronounce'}
        title="Pronounce"
      >
        <SpeakerIcon busy={busy} />
      </button>
      {error && <span className="speak-error">{error}</span>}
    </span>
  );
}
