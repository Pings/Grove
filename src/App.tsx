import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { migrateEntryFields, removeGrowthDemos } from './db/schema';
import { loadLibraryFromServer } from './lib/sync';

export default function App() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        await loadLibraryFromServer();
        await migrateEntryFields();
        await removeGrowthDemos();
      } catch (err) {
        console.error(err);
        setBootError(
          err instanceof Error
            ? `Could not load library from server: ${err.message}`
            : 'Could not load library from server.',
        );
      } finally {
        setReady(true);
      }
    })();
  }, []);

  if (!ready) {
    return (
      <div className="page">
        <div className="panel empty">Loading your library…</div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      {bootError && (
        <div className="alert alert-error" style={{ margin: '1rem' }}>
          {bootError}
        </div>
      )}
      <Routes>
        <Route path="*" element={<Layout />} />
      </Routes>
    </BrowserRouter>
  );
}
