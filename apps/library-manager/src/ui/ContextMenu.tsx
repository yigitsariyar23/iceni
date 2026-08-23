// Right-click menu with one level of submenu, modelled on the row menu in
// MyTube Organizer: the actions live on the row rather than in a toolbar, they
// apply to the whole selection when the row is part of one, and the long list
// (there is one entry per playlist) hangs off a submenu rather than filling
// the screen.
//
// It renders into the page rather than into a portal: the dashboard is the
// whole route, so there is no stacking context above it to escape.

const { useEffect, useLayoutEffect, useRef, useState } = Spicetify.React;

export interface MenuItem {
  label?: string;
  hint?: string;
  danger?: boolean;
  separator?: boolean;
  disabled?: boolean;
  action?: () => void;
  /** Built on hover, so a hundred playlists cost nothing until asked for. */
  submenu?: () => MenuItem[];
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/** Keeps a floating panel inside the viewport near (x, y). */
function useClamped(x: number, y: number, flipFrom?: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    let left = x;
    // A submenu opens to the right of its parent, or to its left when there is
    // no room -- hence flipFrom, the parent's left edge.
    if (left + r.width + 8 > window.innerWidth) {
      left = flipFrom !== undefined ? flipFrom - r.width - 4 : window.innerWidth - r.width - 8;
    }
    setPos({
      left: Math.max(4, left),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 8)),
      ready: true,
    });
  }, [x, y, flipFrom]);
  return { ref, pos };
}

function Panel({
  items,
  x,
  y,
  flipFrom,
  onPick,
  className,
}: {
  items: MenuItem[];
  x: number;
  y: number;
  flipFrom?: number;
  onPick: () => void;
  className: string;
}) {
  const { ref, pos } = useClamped(x, y, flipFrom);
  const [sub, setSub] = useState<{ items: MenuItem[]; x: number; y: number; from: number } | null>(null);

  return (
    <>
      <div
        ref={ref}
        className={className}
        style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((item, i) =>
          item.separator ? (
            <div className="lm-menu__sep" key={`sep${i}`} />
          ) : (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              className={[
                'lm-menu__item',
                item.danger ? 'lm-menu__item--danger' : '',
                item.submenu ? 'lm-menu__item--sub' : '',
              ].join(' ')}
              onMouseEnter={(e) => {
                if (!item.submenu) return setSub(null);
                const r = e.currentTarget.getBoundingClientRect();
                setSub({ items: item.submenu(), x: r.right + 2, y: r.top - 4, from: r.left });
              }}
              onClick={() => {
                if (item.submenu || item.disabled) return;
                onPick();
                item.action?.();
              }}
            >
              <span className="lm-menu__label">{item.label}</span>
              {item.hint ? <span className="lm-menu__hint">{item.hint}</span> : null}
            </button>
          ),
        )}
      </div>

      {sub ? (
        <Panel
          items={sub.items}
          x={sub.x}
          y={sub.y}
          flipFrom={sub.from}
          onPick={onPick}
          className="lm-menu lm-menu--sub"
        />
      ) : null}
    </>
  );
}

export function ContextMenu({ state, onClose }: { state: MenuState | null; onClose: () => void }) {
  useEffect(() => {
    if (!state) return undefined;
    const onDown = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // mousedown rather than click so the menu is gone before whatever is
    // underneath reacts, and capture so nothing can swallow it first.
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    document.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [state, onClose]);

  if (!state) return null;
  return (
    <div
      className="lm-menu__layer"
      // The menu itself sits inside; stopping propagation here would break the
      // outside-click handler, so the layer only blocks the context menu.
      onContextMenu={(e) => e.preventDefault()}
    >
      <Panel items={state.items} x={state.x} y={state.y} onPick={onClose} className="lm-menu" />
    </div>
  );
}
