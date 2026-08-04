import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import {
  exportEntries,
  importEntries,
  resetTimers,
  db,
  ensureSeeded,
} from '../db/schema';
import {
  clearApiKey,
  DEFAULT_LEARNED_AVG_SECONDS,
  ensureSyncProfiles,
  GEMINI_MODELS,
  getActiveProfile,
  getActiveProfileId,
  getApiKey,
  getGeminiModel,
  getLastSyncAt,
  getLearnedAvgSeconds,
  getQuizRefreshMeta,
  getStorageMode,
  getSyncProfiles,
  getSyncUrl,
  makeProfileSyncKey,
  MAX_LEARNED_AVG_SECONDS,
  MIN_LEARNED_AVG_SECONDS,
  removeSyncProfile,
  setApiKey,
  setGeminiModel,
  setLearnedAvgSeconds,
  setStorageMode,
  setSyncKey,
  setSyncUrl,
  upsertSyncProfile,
  type GeminiModelId,
  type StorageMode,
  type SyncProfile,
} from '../lib/settings';
import { countAddedSinceLastRefresh, refreshQuizContent } from '../lib/quizRefresh';
import { pushLocalSnapshot, switchSyncProfile, syncOnBoot, testSyncConnection } from '../lib/sync';

export function SettingsPage() {
  const [apiKey, setApiKeyState] = useState(getApiKey());
  const [model, setModelState] = useState<GeminiModelId>(getGeminiModel());
  const [learnedAvgSec, setLearnedAvgSecState] = useState(getLearnedAvgSeconds);
  const [storageMode, setStorageModeState] = useState<StorageMode>(getStorageMode);
  const [syncUrl, setSyncUrlState] = useState(getSyncUrl);
  const [profiles, setProfilesState] = useState<SyncProfile[]>(() =>
    getStorageMode() === 'sync' ? ensureSyncProfiles() : getSyncProfiles(),
  );
  const [activeProfileId, setActiveProfileIdState] = useState(
    () => getActiveProfileId() ?? getActiveProfile()?.id ?? '',
  );
  const [newProfileName, setNewProfileName] = useState('');
  const [lastSyncAt, setLastSyncAtState] = useState(getLastSyncAt);
  const [syncBusy, setSyncBusy] = useState(false);
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

  function saveKey() {
    setApiKey(apiKey);
    setGeminiModel(model);
    setLearnedAvgSeconds(learnedAvgSec);
    setMessage('Settings saved locally in this browser.');
    setError('');
  }

  function removeKey() {
    clearApiKey();
    setApiKeyState('');
    setMessage('API key cleared.');
  }

  function saveStorage() {
    setStorageMode(storageMode);
    setSyncUrl(syncUrl);
    if (storageMode === 'sync') {
      const list = ensureSyncProfiles();
      setProfilesState(list);
      const active = list.find((p) => p.id === activeProfileId) ?? list[0]!;
      setActiveProfileIdState(active.id);
      setSyncKey(active.syncKey);
      setMessage(
        `Sync on — profile “${active.name}”. Same URL on every device; each profile has its own word list & questions.`,
      );
    } else {
      setMessage('Using this browser only.');
    }
    setError('');
  }

  async function handleTestSync() {
    setSyncBusy(true);
    setError('');
    setMessage('');
    try {
      setStorageMode(storageMode);
      setSyncUrl(syncUrl);
      const list = ensureSyncProfiles();
      const active = list.find((p) => p.id === activeProfileId) ?? list[0]!;
      setSyncKey(active.syncKey);
      const note = await testSyncConnection();
      setMessage(note);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach sync server.');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleSyncNow() {
    setSyncBusy(true);
    setError('');
    setMessage('');
    try {
      setStorageMode('sync');
      setStorageModeState('sync');
      setSyncUrl(syncUrl);
      const list = ensureSyncProfiles();
      const active = list.find((p) => p.id === activeProfileId) ?? list[0]!;
      setSyncKey(active.syncKey);
      const result = await syncOnBoot();
      if (result === 'pulled') setMessage(`Pulled “${active.name}” from the server.`);
      else if (result === 'pushed') setMessage(`Uploaded “${active.name}” to the server.`);
      else setMessage('Sync skipped.');
      setLastSyncAtState(getLastSyncAt());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleForcePush() {
    setSyncBusy(true);
    setError('');
    setMessage('');
    try {
      setStorageMode('sync');
      setStorageModeState('sync');
      setSyncUrl(syncUrl);
      const list = ensureSyncProfiles();
      const active = list.find((p) => p.id === activeProfileId) ?? list[0]!;
      setSyncKey(active.syncKey);
      await pushLocalSnapshot();
      setMessage(`Uploaded this device’s “${active.name}” library.`);
      setLastSyncAtState(getLastSyncAt());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleSwitchProfile(profile: SyncProfile) {
    if (profile.id === activeProfileId) return;
    setSyncBusy(true);
    setError('');
    setMessage('');
    try {
      setStorageMode('sync');
      setStorageModeState('sync');
      setSyncUrl(syncUrl);
      const result = await switchSyncProfile(profile);
      setActiveProfileIdState(profile.id);
      setProfilesState(getSyncProfiles());
      setQuizMeta(getQuizRefreshMeta());
      setLastSyncAtState(getLastSyncAt());
      setMessage(
        result === 'pulled'
          ? `Switched to “${profile.name}” — loaded from server.`
          : `Switched to “${profile.name}” — empty library (fresh profile).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch profile.');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleCreateProfile() {
    const name = newProfileName.trim();
    if (!name) {
      setError('Enter a profile name.');
      return;
    }
    if (profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      setError('That profile name already exists.');
      return;
    }
    setSyncBusy(true);
    setError('');
    setMessage('');
    try {
      setStorageMode('sync');
      setStorageModeState('sync');
      setSyncUrl(syncUrl);
      const profile: SyncProfile = {
        id: crypto.randomUUID(),
        name,
        syncKey: makeProfileSyncKey(name),
      };
      upsertSyncProfile(profile);
      setProfilesState(getSyncProfiles());
      setNewProfileName('');
      const result = await switchSyncProfile(profile);
      setActiveProfileIdState(profile.id);
      setQuizMeta(getQuizRefreshMeta());
      setLastSyncAtState(getLastSyncAt());
      setMessage(
        result === 'empty'
          ? `Created “${name}” — starting with no words. Add cards, then Sync.`
          : `Created “${name}” and loaded remote data.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create profile.');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleDeleteProfile(profile: SyncProfile) {
    if (profiles.length <= 1) {
      setError('Keep at least one profile.');
      return;
    }
    if (!window.confirm(`Remove profile “${profile.name}” from this device? Server data is kept.`)) {
      return;
    }
    const remaining = removeSyncProfile(profile.id);
    setProfilesState(remaining);
    if (profile.id === activeProfileId && remaining[0]) {
      await handleSwitchProfile(remaining[0]);
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
      setMessage(`Imported ${count} entries (merged by hanzi).`);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    }
  }

  async function handleResetTimers() {
    if (!confirm('Reset all flashcard timers and review schedules?')) return;
    await resetTimers();
    setMessage('Flashcard timers reset.');
  }

  async function handleReseed() {
    if (
      !confirm(
        'This deletes your library and reloads the starter Chinese Board seed. Continue?',
      )
    ) {
      return;
    }
    await db.entries.clear();
    await ensureSeeded();
    setMessage('Library reseeded from Chinese Board content.');
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  }

  const lastRefreshLabel = quizMeta
    ? new Date(quizMeta.lastQuizRefreshAt).toLocaleString()
    : 'Never';
  const lastSyncLabel = lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'Never';

  return (
    <div className="stack">
      <header className="page-header">
        <h1>Settings</h1>
        <p>Water the roots — API key, backups, and how green “learned” cards grow.</p>
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
          . Stored only in localStorage on this device.
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
          Library storage
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Word list and quiz questions can live in this browser only, or on your sync server under a{' '}
          <strong>profile</strong> (e.g. Nikko). Switching profile loads that profile’s data — a new
          profile starts empty.
        </p>
        <div className="row">
          <button
            type="button"
            className={`chip ${storageMode === 'local' ? 'active' : ''}`}
            onClick={() => setStorageModeState('local')}
          >
            This browser
          </button>
          <button
            type="button"
            className={`chip ${storageMode === 'sync' ? 'active' : ''}`}
            onClick={() => {
              setStorageModeState('sync');
              const list = ensureSyncProfiles();
              setProfilesState(list);
              setActiveProfileIdState(getActiveProfileId() ?? list[0]!.id);
            }}
          >
            Sync to server
          </button>
        </div>
        {storageMode === 'sync' && (
          <>
            <label className="field">
              Sync server URL
              <input
                type="url"
                value={syncUrl}
                onChange={(e) => setSyncUrlState(e.target.value)}
                placeholder="http://your-nas:8090"
                autoComplete="off"
              />
            </label>

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
                    disabled={syncBusy}
                    onClick={() => void handleSwitchProfile(p)}
                    title={`Key: ${p.syncKey.slice(0, 12)}…`}
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
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={syncBusy}
                  onClick={() => void handleCreateProfile()}
                >
                  Create
                </button>
              </div>
              {profiles.length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={syncBusy}
                  onClick={() => {
                    const active = profiles.find((p) => p.id === activeProfileId);
                    if (active) void handleDeleteProfile(active);
                  }}
                >
                  Remove active profile from this device
                </button>
              )}
            </div>

            <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
              Active: <strong>{profiles.find((p) => p.id === activeProfileId)?.name ?? '—'}</strong>
              . Last sync: {lastSyncLabel}. Same server URL on every device; pick the same profile
              name after creating it once (or share the profile key).
            </p>
          </>
        )}
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={saveStorage}>
            Save storage
          </button>
          {storageMode === 'sync' && (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={syncBusy}
                onClick={() => void handleTestSync()}
              >
                Test connection
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={syncBusy}
                onClick={() => void handleSyncNow()}
              >
                {syncBusy ? 'Syncing…' : 'Sync now'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={syncBusy}
                onClick={() => void handleForcePush()}
              >
                Upload this device
              </button>
            </>
          )}
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
          <button type="button" className="btn btn-danger" onClick={() => void handleReseed()}>
            Reseed library
          </button>
        </div>
      </section>

      {message && <div className="alert alert-info">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}
    </div>
  );
}
