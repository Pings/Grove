import { useEffect, useState, type ReactNode } from 'react';

type Props = {
  title: string;
  /** When true, expand if content exists (or alwaysExpand). */
  hasContent: boolean;
  children: ReactNode;
  /** Force open regardless of content (e.g. while editing). */
  forceOpen?: boolean;
};

/** Collapsed by default when empty; open by default when hasContent. */
export function CollapsibleSection({ title, hasContent, children, forceOpen }: Props) {
  const [open, setOpen] = useState(() => Boolean(forceOpen || hasContent));

  useEffect(() => {
    if (forceOpen || hasContent) setOpen(true);
  }, [forceOpen, hasContent]);

  return (
    <div className={`collapsible-section ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="collapsible-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{title}</span>
        <span className="collapsible-chevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}
