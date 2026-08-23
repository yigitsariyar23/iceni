// A dropdown that is ours rather than the platform's.
//
// A native <select> renders as a macOS popup button: system font, system
// accent, system corner radius, drawn by the OS above the page and completely
// deaf to the theme. One of those in the middle of a Catppuccin page reads as
// a bug. This is a plain button plus an absolutely positioned listbox, so it
// takes the same variables as everything else here.
//
// Keyboard behaviour follows the WAI-ARIA listbox pattern closely enough to be
// usable without a mouse: Up/Down move, Home/End jump, Enter/Space commit,
// Escape closes without committing, and typing jumps to the first match.

const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = Spicetify.React;

export interface Option {
  value: string;
  label: string;
  /** Rendered dimmer, after the label -- counts, hints, that sort of thing. */
  hint?: string;
  disabled?: boolean;
  /** Consecutive options sharing a group get one heading above them. */
  group?: string;
}

export function Select({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  ariaLabel,
  disabled,
  width,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  width?: number | string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });

  const selectedIndex = useMemo(
    () => options.findIndex((o) => o.value === value),
    [options, value],
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const close = useCallback(() => setOpen(false), []);

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) return;
      onChange(option.value);
      setOpen(false);
      rootRef.current?.querySelector('button')?.focus();
    },
    [options, onChange],
  );

  // Opening starts from the current value so Up/Down move relative to it.
  useEffect(() => {
    if (open) setActive(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    // Capture: a click inside the page's own handlers should not get the event
    // first and leave the list hanging open over whatever it navigated to.
    document.addEventListener('mousedown', onDown, true);
    // No scroll handler: the list is absolutely positioned inside the select,
    // so it travels with the button. Closing on scroll made the list
    // impossible to use -- reaching for an option far down it scrolls the
    // list, and that shut it.
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  // Keep the active option in view while arrowing through a long list.
  useLayoutEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[active];
    node?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const step = (from: number, delta: number) => {
    const n = options.length;
    for (let i = 1; i <= n; i++) {
      const next = (from + delta * i + n * i) % n;
      if (!options[next]?.disabled) return next;
    }
    return from;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        close();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => step(a, 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((a) => step(a, -1));
        break;
      case 'Home':
        e.preventDefault();
        setActive(step(-1, 1));
        break;
      case 'End':
        e.preventDefault();
        setActive(step(options.length, -1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        commit(active);
        break;
      default: {
        if (e.key.length !== 1) break;
        // Type-ahead: keystrokes within a second accumulate into one prefix.
        const now = Date.now();
        const text = (now - typed.current.at < 1000 ? typed.current.text : '') + e.key.toLowerCase();
        typed.current = { text, at: now };
        const hit = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(text));
        if (hit >= 0) setActive(hit);
      }
    }
  };

  return (
    <div className="lm-select" ref={rootRef} style={width ? { width } : undefined}>
      <button
        type="button"
        className={`lm-select__button ${open ? 'lm-select__button--open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? 'lm-select__value' : 'lm-select__value lm-select__value--empty'}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="lm-select__caret" aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div className="lm-select__list" role="listbox" ref={listRef} tabIndex={-1}>
          {options.map((o, i) => (
            <Spicetify.React.Fragment key={o.value}>
            {o.group && o.group !== options[i - 1]?.group ? (
              <div className="lm-select__group">{o.group}</div>
            ) : null}
            <div
              role="option"
              aria-selected={o.value === value}
              className={[
                'lm-select__option',
                i === active ? 'lm-select__option--active' : '',
                o.value === value ? 'lm-select__option--on' : '',
                o.disabled ? 'lm-select__option--off' : '',
              ].join(' ')}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                // mousedown, not click: the outside-click handler above runs on
                // mousedown and would close the list before click ever fired.
                e.preventDefault();
                commit(i);
              }}
            >
              <span className="lm-select__label">{o.label}</span>
              {o.hint ? <span className="lm-select__hint">{o.hint}</span> : null}
            </div>
            </Spicetify.React.Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
