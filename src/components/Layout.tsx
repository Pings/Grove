import { useCallback, useState } from 'react';
import { NavLink, Navigate, useLocation } from 'react-router-dom';
import { LibraryPage } from '../pages/Library';
import { AddPage } from '../pages/Add';
import { FlashcardsPage } from '../pages/Flashcards';
import { ComposePage } from '../pages/Compose';
import { SentenceMakerPage } from '../pages/SentenceMaker';
import { LinesPage } from '../pages/Lines';
import { CountPage } from '../pages/Count';
import { SettingsPage } from '../pages/Settings';
import { LibraryDrawer, getStoredDrawerOpen } from './LibraryDrawer';
import { APP_VERSION } from '../version';

const links = [
  { to: '/', label: 'Shelf', zh: '词库', end: true },
  { to: '/lines', label: 'Lines', zh: '例句' },
  { to: '/add', label: 'Gather', zh: '采词' },
  { to: '/flashcards', label: 'Tend', zh: '培' },
  { to: '/count', label: 'Count', zh: '数' },
  { to: '/compose', label: 'Temper', zh: '炼句' },
  { to: '/sentences', label: 'Forms', zh: '句式' },
  { to: '/settings', label: 'Settings' },
];

const TABS = [
  { path: '/', match: (p: string) => p === '/', element: <LibraryPage />, key: 'library' },
  { path: '/lines', match: (p: string) => p === '/lines', element: <LinesPage />, key: 'lines' },
  { path: '/add', match: (p: string) => p === '/add', element: <AddPage />, key: 'add' },
  {
    path: '/flashcards',
    match: (p: string) => p === '/flashcards',
    element: <FlashcardsPage />,
    key: 'flashcards',
  },
  { path: '/count', match: (p: string) => p === '/count', element: <CountPage />, key: 'count' },
  { path: '/compose', match: (p: string) => p === '/compose', element: <ComposePage />, key: 'compose' },
  {
    path: '/sentences',
    match: (p: string) => p === '/sentences',
    element: <SentenceMakerPage />,
    key: 'sentences',
  },
  {
    path: '/settings',
    match: (p: string) => p === '/settings',
    element: <SettingsPage />,
    key: 'settings',
  },
] as const;

function BrandMark() {
  return (
    <a className="brand" href="/" aria-label="Grove — back to tools">
      <svg className="brand-leaf" viewBox="0 0 40 48" aria-hidden>
        <path
          d="M20 46c0-18 14-28 14-40C24 8 20 2 20 2S16 8 6 6c0 12 14 22 14 40Z"
          fill="currentColor"
        />
        <path
          d="M20 10v32"
          fill="none"
          stroke="color-mix(in srgb, #faf7f0 55%, transparent)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <span className="brand-word">Grove</span>
    </a>
  );
}

export function Layout() {
  const location = useLocation();
  const path = location.pathname;
  const known = TABS.some((t) => t.match(path));
  const [drawerOpen, setDrawerOpen] = useState(getStoredDrawerOpen);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleDrawer = useCallback(() => setDrawerOpen((v) => !v), []);

  if (!known) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="app-shell">
      <div className="grove-atmosphere" aria-hidden />
      <span className="app-version" title={`Grove v${APP_VERSION}`}>
        v{APP_VERSION}
      </span>
      <header className="top-nav">
        <BrandMark />
        <nav className="nav-links">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              <span className="nav-en">{link.label}</span>
              {'zh' in link && link.zh ? <span className="nav-zh">{link.zh}</span> : null}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="page page-tabs">
        {TABS.map((tab) => {
          const active = tab.match(path);
          return (
            <div
              key={tab.key}
              className={`tab-panel ${active ? 'is-active' : ''}`}
              hidden={!active}
              aria-hidden={!active}
            >
              {tab.element}
            </div>
          );
        })}
      </main>

      <LibraryDrawer open={drawerOpen} onClose={closeDrawer} onToggle={toggleDrawer} />
    </div>
  );
}
