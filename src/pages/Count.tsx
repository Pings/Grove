import { useEffect, useMemo, useState } from 'react';
import { SpeakButton } from '../components/SpeakButton';
import {
  CORE_DIGITS,
  buildCountChoices,
  checkCountAnswer,
  makeCountPrompt,
  type CountMode,
  type CountPrompt,
} from '../lib/numbers';

const MODES: Array<{ id: CountMode; title: string; hint: string }> = [
  { id: 'digits', title: 'Digits', hint: '0–99 in characters' },
  { id: 'dates', title: 'Dates', hint: 'Years, months, days, weekdays' },
  { id: 'times', title: 'Times', hint: '…点…分 / 半' },
  { id: 'phone', title: 'Phone', hint: 'Digit by digit' },
];

type PracticeStyle = 'type' | 'tap';

export function CountPage() {
  const [mode, setMode] = useState<CountMode>('digits');
  const [style, setStyle] = useState<PracticeStyle>('type');
  const [prompt, setPrompt] = useState<CountPrompt>(() => makeCountPrompt('digits'));
  const [choices, setChoices] = useState<string[]>([]);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [correct, setCorrect] = useState(false);
  const [stats, setStats] = useState({ correct: 0, wrong: 0 });

  function loadNext(nextMode: CountMode = mode) {
    const p = makeCountPrompt(nextMode);
    setPrompt(p);
    setChoices(buildCountChoices(p));
    setAnswer('');
    setRevealed(false);
    setCorrect(false);
  }

  useEffect(() => {
    loadNext(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on mode change only
  }, [mode]);

  useEffect(() => {
    if (style === 'tap') setChoices(buildCountChoices(prompt));
  }, [style, prompt.id]);

  function submit(raw: string) {
    if (revealed) return;
    const ok = checkCountAnswer(prompt, raw);
    setAnswer(raw);
    setCorrect(ok);
    setRevealed(true);
    setStats((s) => ({
      correct: s.correct + (ok ? 1 : 0),
      wrong: s.wrong + (ok ? 0 : 1),
    }));
  }

  const scoreLabel = useMemo(
    () => `${stats.correct}✓ · ${stats.wrong}✗`,
    [stats.correct, stats.wrong],
  );

  return (
    <div className="stack count-page">
      <header className="page-header">
        <h1>
          Count <span className="page-title-zh">数</span>
        </h1>
        <p>Keep 1–10 in view while you drill dates (with years), times, and phone numbers.</p>
      </header>

      <section className="count-strip" aria-label="Numbers 0 to 10">
        <div className="count-strip-label muted">Reference</div>
        <div className="count-strip-grid">
          {CORE_DIGITS.map((d) => (
            <div key={d.n} className="count-digit">
              <span className="count-digit-n">{d.n}</span>
              <span className="count-digit-zh">{d.hanzi}</span>
              <span className="count-digit-py">{d.pinyin}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel stack">
        <div className="maker-levels count-modes">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`maker-level-btn ${mode === m.id ? 'active' : ''}`}
              onClick={() => setMode(m.id)}
            >
              <span className="maker-level-title">{m.title}</span>
              <span className="maker-level-hint">{m.hint}</span>
            </button>
          ))}
        </div>

        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div className="row">
            <button
              type="button"
              className={`chip ${style === 'type' ? 'active' : ''}`}
              onClick={() => setStyle('type')}
            >
              Type
            </button>
            <button
              type="button"
              className={`chip ${style === 'tap' ? 'active' : ''}`}
              onClick={() => setStyle('tap')}
            >
              Tap
            </button>
          </div>
          <span className="muted">{scoreLabel}</span>
        </div>
      </section>

      <section className="panel stack count-stage">
        <div className="badge">{MODES.find((m) => m.id === mode)?.title}</div>
        {prompt.hint && (
          <div className="muted" style={{ fontSize: '0.88rem' }}>
            {prompt.hint}
          </div>
        )}

        <div className="count-prompt">{prompt.prompt}</div>

        {style === 'type' && (
          <>
            <label className="field">
              Chinese
              <input
                type="text"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && answer.trim() && !revealed) {
                    e.preventDefault();
                    submit(answer);
                  }
                }}
                placeholder="Type in Chinese…"
                disabled={revealed}
                style={{ fontFamily: 'var(--font-zh-display)', fontSize: '1.35rem' }}
                autoComplete="off"
                autoFocus
              />
            </label>
            {!revealed && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!answer.trim()}
                onClick={() => submit(answer)}
              >
                Check
              </button>
            )}
          </>
        )}

        {style === 'tap' && !revealed && (
          <div className="mc-grid">
            {choices.map((choice) => (
              <button
                key={choice}
                type="button"
                className="mc-option"
                onClick={() => submit(choice)}
              >
                <span className="mc-primary" style={{ fontFamily: 'var(--font-zh-display)', fontWeight: 400 }}>
                  {choice}
                </span>
              </button>
            ))}
          </div>
        )}

        {revealed && (
          <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
            <div
              className={`alert ${correct ? 'alert-info' : 'alert-warn'}`}
              style={{ width: '100%' }}
            >
              {correct ? 'Correct!' : 'Not quite — here’s the reading.'}
            </div>
            <div className="hanzi-speak-row" style={{ width: '100%', justifyContent: 'center' }}>
              <div className="hanzi-xl">{prompt.reveal}</div>
              <SpeakButton hanzi={prompt.reveal} />
            </div>
            {style === 'tap' && (
              <div className="mc-grid" style={{ opacity: 0.85 }}>
                {choices.map((choice) => {
                  let cls = 'mc-option mc-dim';
                  if (choice === prompt.reveal) cls = 'mc-option mc-correct';
                  else if (!correct && normalizeLoose(choice) === normalizeLoose(answer)) {
                    cls = 'mc-option mc-wrong';
                  }
                  return (
                    <button key={choice} type="button" className={cls} disabled>
                      <span className="mc-primary" style={{ fontFamily: 'var(--font-zh-display)', fontWeight: 400 }}>
                        {choice}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <button type="button" className="btn btn-primary" onClick={() => loadNext()}>
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function normalizeLoose(text: string): string {
  return text.replace(/\s+/g, '').trim();
}
