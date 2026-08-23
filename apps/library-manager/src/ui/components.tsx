// Small shared pieces. Everything is plain markup over the theme's own
// variables -- no encore components -- so the page keeps working when Spotify
// renames a class, which it does every few releases.

const { useEffect, useRef, useState } = Spicetify.React;

import { fmtInt } from './format';

export { fmtInt, fmtDuration, fmtDate } from './format';

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="lm-stat">
      <div className="lm-stat__value">{value}</div>
      <div className="lm-stat__label">{label}</div>
      {hint ? <div className="lm-stat__hint">{hint}</div> : null}
    </div>
  );
}

export function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="lm-bar">
      <div className="lm-bar__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="lm-empty">{children}</div>;
}

export function Section({
  title,
  count,
  description,
  children,
}: {
  title: string;
  count?: number;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="lm-section">
      <header className="lm-section__head">
        <h2>
          {title}
          {typeof count === 'number' ? <span className="lm-pill">{fmtInt(count)}</span> : null}
        </h2>
        {description ? <p>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

/**
 * A destructive action always goes through here. Nothing in this app writes to
 * the library without the user having read the exact count first -- a mistake
 * in a bulk edit is not something Spotify offers an undo for.
 */
export function Confirm({
  open,
  title,
  body,
  confirmLabel,
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  /** Additive actions are not destructive and should not be dressed as such. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="lm-modal" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="lm-modal__panel" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="lm-modal__body">{body}</div>
        <div className="lm-modal__actions">
          <button type="button" className="lm-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? 'lm-btn lm-btn--danger' : 'lm-btn lm-btn--primary'}
            ref={ref}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Debounced text input, so typing in the filter does not re-render per key. */
export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    const id = setTimeout(() => {
      if (local !== value) onChange(local);
    }, 160);
    return () => clearTimeout(id);
    // `value` and `onChange` are intentionally out of the dependency list:
    // including them restarts the timer on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return (
    <input
      className="lm-input"
      type="search"
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.currentTarget.value)}
    />
  );
}
