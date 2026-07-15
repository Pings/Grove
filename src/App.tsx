import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ensureSeeded } from './db/schema';

export default function App() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState('');

  useEffect(() => {
    ensureSeeded()
      .then(() => setReady(true))
      .catch((err) => {
        console.error(err);
        setBootError(err instanceof Error ? err.message : 'Failed to start database.');
        setReady(true);
      });
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
