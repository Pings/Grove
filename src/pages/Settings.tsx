import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import {
  exportEntries,
  importEntries,
  resetTimers,
  db,
} from '../db/schema';
import {
  clearApiKey,
  DEFAULT_LEARNED_AVG_SECONDS,
  GEMINI_MODELS,
  getActiveProfileId,
  getApiKey,
  getGeminiModel,
  getLearnedAvgSeconds,
  getQuizRefreshMeta,
  MAX_LEARNED_AVG_SECONDS,
  MIN_LEARNED_AVG_SECONDS,
  setApiKey,
  setGeminiModel,
  setLearnedAvgSeconds,
  setQuizRefreshMeta,
  type GeminiModelId,
  type SyncProfile,
} from '../lib/settings';
import { countAddedSinceLastRefresh, refreshQuizContent } from '../lib/quizRefresh';
import {
  createRemoteProfile,
  deleteRemoteProfile,
  fetchProfiles,
  getCachedProfiles,
  getLastServerAt,
  pushLocalSnapshot,
  reloadActiveProfile,
  scheduleSyncPush,
  switchSyncProfile,
} from '../lib/sync';

export function SettingsPage() {
  const [apiKey, setApiKeyState] = useState(getApiKey());
  const [model, setModelState] = useState<GeminiModelId>(getGeminiModel());
  const [learnedAvgSec, setLearnedAvgSecState] = useState(getLearnedAvgSeconds);
  const [profiles, setProfilesState] = useState<SyncProfile[]>(() => getCachedProfiles());
  const [activeProfileId, setActiveProfileIdState] = useState(
    () => getActiveProfileId() ?? getCachedProfiles()[0]?.id ?? '',
  );
  const [newProfileName, setNewProfileName] = useState('');
  const [lastServerAt, setLastServerAtState] = useState(getLastServerAt);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [addedSinceRefresh, setAddedSinceRefresh] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [quizMeta, setQuizMeta] = useState(getQuizRefreshMeta());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void countAddedSinceLastRefresh().then(setAddedSinceRefresh);
    const sub = liveQuery(() => db.entries.toArray()).subscribe({
      next: () => {
        void countAddedSinceLastRefresh().then(setAddedSinceRefresh);
      },
      error: console.error,
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    void fetchProfiles()
      .then((list) => {
        setProfilesState(list);
        const id = getActiveProfileId() ?? list.find((p) => p.id === 'nikko')?.id ?? list[0]?.id ?? '';
        setActiveProfileIdState(id);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Could not load profiles.');
      });
  }, []);

  function saveKey() {
    setApiKey(apiKey);
    setGeminiModel(model);
    setLearnedAvgSeconds(learnedAvgSec);
    setMessage('API settings saved in this browser.');
    setError('');
  }

  function removeKey() {
    clearApiKey();
    setApiKeyState('');
    setMessage('API key cleared.');
  }

  async function handleReload() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await reloadActiveProfile();
      setQuizMeta(getQuizRefreshMeta());
      setLastServerAtState(getLastServerAt());
      setMessage(result === 'pulled' ? 'Reloaded library from the server.' : 'Active profile is empty.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitchProfile(profile: SyncProfile) {
    if (profile.id === activeProfileId) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await switchSyncProfile(profile);
      setActiveProfileIdState(profile.id);
      setProfilesState(getCachedProfiles());
      setQuizMeta(getQuizRefreshMeta());
      setLastServerAtState(getLastServerAt());
      setMessage(
        result === 'pulled'
          ? `Switched to “${profile.name}”.`
          : `Switched to “${profile.name}” — empty library.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch profile.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateProfile() {
    const name = newProfileName.trim();
    if (!name) {
      setError('Enter a profile name.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { profile, profiles: list } = await createRemoteProfile(name);
      setProfilesState(list);
      setNewProfileName('');
      const result = await switchSyncProfile(profile, { pushCurrent: true });
      setActiveProfileIdState(profile.id);
      setQuizMeta(getQuizRefreshMeta());
      setLastServerAtState(getLastServerAt());
      setMessage(
        result === 'empty'
          ? `Created “${name}” with a new empty word database.`
          : `Created “${name}”.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create profile.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteProfile(profile: SyncProfile) {
    if (profile.id === 'nikko' || profile.name === 'Nikko') {
      setError('Cannot delete Nikko.');
      return;
    }
    if (!window.confirm(`Delete profile “${profile.name}” from the server list? (Word data files are kept.)`)) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const remaining = await deleteRemoteProfile(profile.id);
      setProfilesState(remaining);
      if (profile.id === activeProfileId && remaining[0]) {
        await handleSwitchProfile(remaining[0]);
      }
      setMessage(`Removed “${profile.name}” from the profile list.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete profile.');
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    const exported = await exportEntries();
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `grove-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage(`Exported ${exported.length} entries.`);
  }

  async function handleImport(file: File) {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as import('../types').VocabEntry[];
      if (!Array.isArray(data)) throw new Error('Backup must be a JSON array.');
      const count = await importEntries(data);
      scheduleSyncPush(400);
      setMessage(`Imported ${count} entries (merged by hanzi) — saving to server.`);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    }
  }

  async function handleResetTimers() {
    if (!confirm('Reset all flashcard timers and review schedules?')) return;
    await resetTimers();
    scheduleSyncPush(400);
    setMessage('Flashcard timers reset — saving to server.');
  }

  async function handleClearLibrary() {
    if (
      !confirm(
        'Delete all words and quiz questions in the active profile on the server? This cannot be undone.',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await db.entries.clear();
      await db.quizQuestions.clear();
      setQuizRefreshMeta(null);
      await pushLocalSnapshot({
        updatedAt: Date.now(),
        entries: [],
        quizQuestions: [],
        quizRefreshMeta: null,
      });
      setQuizMeta(null);
      setLastServerAtState(getLastServerAt());
      setMessage('Active profile cleared on the server.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear library.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshQuiz() {
    if (!getApiKey()) {
      setError('Add your Gemini API key above before refreshing quiz content.');
      setMessage('');
      return;
    }
    setRefreshing(true);
    setError('');
    setMessage('');
    try {
      const result = await refreshQuizContent();
      const hskLabel =
        result.analysedHsk === 'unknown' ? 'HSK 1–3' : `HSK ${result.analysedHsk}`;
      const queued =
        result.flashcardsQueued > 0
          ? ` ${result.flashcardsQueued} new cards queued for flashcards.`
          : '';
      setMessage(
        `Updated ${result.questionsGenerated} quiz questions (${hskLabel}).${queued} Forms will use the new pool.`,
      );
      setAddedSinceRefresh(0);
      setQuizMeta(getQuizRefreshMeta());
      scheduleSyncPush(400);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  }

  const lastRefreshLabel = quizMeta
    ? new Date(quizMeta.lastQuizRefreshAt).toLocaleString()
    : 'Never';
  const lastSaveLabel = lastServerAt ? new Date(lastServerAt).toLocaleString() : '—';
  const activeName = profiles.find((p) => p.id === activeProfileId)?.name ?? '—';

  return (
    <div className="stack">
      <header className="page-header">
        <h1>Settings</h1>
        <p>API key stays in this browser. Word lists live on the Grove server.</p>
      </header>

      <section className="panel stack">
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>
          Gemini API key
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Free key from{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            Google AI Studio
          </a>
          . This is the only library-related secret stored in the browser.
        </p>
        <label className="field">
          API key
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKeyState(e.target.value)}
            placeholder="AIza…"
            autoComplete="off"
          />
        </label>
        <label className="field">
          Model
          <select
            value={model}
            onChange={(e) => setModelState(e.target.value as GeminiModelId)}
          >
            {GEMINI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
          Free tier is real but limited (requests per minute/day). If you see “quota exceeded”,
          wait ~1 minute or switch to Flash Lite. Check{' '}
          <a href="https://aistudio.google.com/usage" target="_blank" rel="noreferrer">
            usage
          </a>
          .
        </p>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={saveKey}>
            Save settings
          </button>
          <button type="button" className="btn btn-ghost" onClick={removeKey}>
            Clear key
          </button>
        </div>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>
          Word database
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Words and quiz questions are saved on the machine running Grove (not in this browser).
          Edits upload automatically. <strong>Nikko</strong> is the main library. Create a new
          profile only when you want a separate empty database.
        </p>

        <div className="stack" style={{ gap: '0.45rem' }}>
          <div className="muted" style={{ fontWeight: 600 }}>
            Profiles
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`chip ${p.id === activeProfileId ? 'active' : ''}`}
                disabled={busy}
                onClick={() => void handleSwitchProfile(p)}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="field grow" style={{ margin: 0 }}>
              New profile
              <input
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="e.g. Practice"
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreateProfile();
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => void handleCreateProfile()}
            >
              Create empty DB
            </button>
          </div>
          {profiles.some((p) => p.id === activeProfileId && p.name !== 'Nikko' && p.id !== 'nikko') && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                const active = profiles.find((p) => p.id === activeProfileId);
                if (active) void handleDeleteProfile(active);
              }}
            >
              Remove active profile from list
            </button>
          )}
        </div>

        <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
          Active: <strong>{activeName}</strong>. Last server save: {lastSaveLabel}.
        </p>
        <div className="row">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void handleReload()}
          >
            {busy ? 'Working…' : 'Reload from server'}
          </button>
        </div>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>
          Learned threshold
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Shelf cards turn green when your average flashcard response time is at or under this
          (after enough reviews). Default {DEFAULT_LEARNED_AVG_SECONDS}s.
        </p>
        <label className="field">
          Average guess time ≤ {learnedAvgSec}s
          <input
            type="range"
            min={MIN_LEARNED_AVG_SECONDS}
            max={MAX_LEARNED_AVG_SECONDS}
            step={0.5}
            value={learnedAvgSec}
            onChange={(e) => setLearnedAvgSecState(Number(e.target.value))}
          />
        </label>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {MIN_LEARNED_AVG_SECONDS}s (stricter)
          </span>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {MAX_LEARNED_AVG_SECONDS}s (easier)
          </span>
        </div>
        <button type="button" className="btn btn-secondary" onClick={saveKey}>
          Save threshold
        </button>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>
          Quiz &amp; questions
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          <strong>
            {addedSinceRefresh} word{addedSinceRefresh === 1 ? '' : 's'}/phrase
            {addedSinceRefresh === 1 ? '' : 's'} added
          </strong>{' '}
          since last quiz refresh.
        </p>
        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
          Last refresh: {lastRefreshLabel}
          {quizMeta ? ` · ${quizMeta.questionCount} questions stored` : ''}
          {quizMeta?.analysedHsk != null && quizMeta.analysedHsk !== 'unknown'
            ? ` · estimated HSK ${quizMeta.analysedHsk}`
            : ''}
          {' '}
          (saved with this profile on the server).
        </p>
        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
          Gemini analyses your library (learned + recent vocab, HSK 1–3) and generates a fresh
          question bank for Forms. New words since the last refresh are also queued for
          flashcards.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={refreshing}
          onClick={() => void handleRefreshQuiz()}
        >
          {refreshing ? 'Updating quiz…' : 'Update quiz & questions'}
        </button>
        {!getApiKey() && (
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Gemini API key required for refresh.
          </p>
        )}
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>
          Backup
        </h2>
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={() => void handleExport()}>
            Export JSON
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
              e.target.value = '';
            }}
          />
        </div>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>
          Data tools
        </h2>
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={() => void handleResetTimers()}>
            Reset flashcard timers
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => void handleClearLibrary()}
          >
            Clear active profile
          </button>
        </div>
      </section>

      {message && <div className="alert alert-info">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}
    </div>
  );
}
