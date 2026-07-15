import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../db/schema';
import { matchesSearch } from '../lib/pinyin';
import type { VocabEntry } from '../types';

const OPEN_KEY = 'chineseLearning.libraryDrawerOpen';
const QUERY_KEY = 'chineseLearning.libraryDrawerQuery';

type Props = {
  open: boolean;
  onClose: () => void;
  onToggle: () => void;
};

export function LibraryDrawer({ open, onClose, onToggle }: Props) {
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [query, setQuery] = useState(() => sessionStorage.getItem(QUERY_KEY) ?? '');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    sessionStorage.setItem(OPEN_KEY, open ? '1' : '0');
  }, [open]);

  useEffect(() => {
    sessionStorage.setItem(QUERY_KEY, query);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    const sub = liveQuery(() => db.entries.toArray()).subscribe({
      next: (rows) => {
        const seen = new Set<string>();
        setEntries(
          rows
            .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
            .filter((e) => {
              const key = e.hanzi.replace(/\s+/g, '');
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .sort((a, b) => a.hanzi.localeCompare(b.hanzi, 'zh')),
        );
      },
      error: console.error,
    });
    return () => sub.unsubscribe();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return entries.slice(0, 40);
    return entries.filter((e) => matchesSearch(e, q)).slice(0, 60);
  }, [entries, query]);

  async function handlePick(entry: VocabEntry) {
    try {
      await navigator.clipboard.writeText(entry.hanzi);
      setCopiedId(entry.id ?? null);
      window.setTimeout(() => setCopiedId(null), 1200);
      window.dispatchEvent(
        new CustomEvent('hanzi-board:insert', { detail: { hanzi: entry.hanzi, english: entry.english } }),
      );
    } catch {
      window.dispatchEvent(
        new CustomEvent('hanzi-board:insert', { detail: { hanzi: entry.hanzi, english: entry.english } }),
      );
    }
  }

  return (
    <>
      <div
        className={`library-drawer-backdrop ${open ? 'is-open' : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`library-drawer ${open ? 'is-open' : ''}`}
        aria-hidden={!open}
        aria-label="Shelf"
      >
        <button
          type="button"
          className={`library-pull-tab ${open ? 'is-open' : ''}`}
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="library-drawer-panel"
          title={open ? 'Close shelf' : 'Open shelf'}
          aria-label={open ? 'Close shelf' : 'Open shelf'}
        >
          <span className="library-pull-tab-zh" aria-hidden>
            词
          </span>
          <span className="library-pull-tab-en">Shelf</span>
          <span className="library-pull-tab-zh-label">词库</span>
        </button>

        <div id="library-drawer-panel" className="library-drawer-panel">
          <div className="library-drawer-header">
            <div>
              <strong>
                Shelf <span className="page-title-zh">词库</span>
              </strong>
              <div className="muted" style={{ fontSize: '0.82rem' }}>
                Search · tap to copy
              </div>
            </div>
            <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
              Close
            </button>
          </div>

          <label className="field library-drawer-search">
            <span className="sr-only">Search shelf</span>
            <input
              type="search"
              placeholder="明天 · mingtian · tomorrow"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus={open}
            />
          </label>

          <div className="library-drawer-list">
            {filtered.length === 0 ? (
              <div className="empty" style={{ padding: '1.5rem 0.5rem' }}>
                No matches
              </div>
            ) : (
              filtered.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="library-drawer-item"
                  onClick={() => void handlePick(entry)}
                >
                  <div className="library-drawer-item-top">
                    <span className="hanzi">{entry.hanzi}</span>
                    {copiedId === entry.id && <span className="copied-pill">Copied</span>}
                  </div>
                  <div className="pinyin">{entry.pinyin}</div>
                  <div className="english">{entry.english}</div>
                </button>
              ))
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

export function getStoredDrawerOpen(): boolean {
  return sessionStorage.getItem(OPEN_KEY) === '1';
}
