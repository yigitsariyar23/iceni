// The row list.
//
// A <table> sizes its columns from its content, so one long track title drags
// the whole column wider and every other column narrower -- the layout moves
// as you filter. This is a CSS grid instead, with the same track list shared
// by the header and every row through a custom property. Columns have a fixed
// base width and text that does not fit is clipped, never allowed to push.
//
// Clipped text is still readable: hovering a cell slides it far enough to
// show the end. That is measured on hover rather than continuously, so it
// costs nothing while scrolling.
//
// Column widths can be dragged and are remembered, which follows how MyTube
// Organizer's channel list behaves.

const { useCallback, useEffect, useMemo, useRef, useState } = Spicetify.React;

export interface Column<K extends string> {
  key: K;
  label: string;
  /** Grid track for the default layout, e.g. '96px' or 'minmax(160px, 1.6fr)'. */
  track: string;
  /** Floor for a drag, in px. */
  min: number;
  sortable?: boolean;
  align?: 'right';
  /** Kept out of the layout below this container width. */
  hideBelow?: number;
}

export type SortDir = 'asc' | 'desc' | null;

/** Header clicks cycle none -> descending -> ascending, as MyTube's do. */
export function nextSort(current: SortDir): SortDir {
  return current === null ? 'desc' : current === 'desc' ? 'asc' : null;
}

function widthKey(id: string) {
  return `iceni:library-manager:cols:${id}`;
}

export function useColumns<K extends string>(id: string, columns: Column<K>[]) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(widthKey(id)) ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  });

  const persist = useCallback(
    (next: Record<string, number>) => {
      setWidths(next);
      try {
        localStorage.setItem(widthKey(id), JSON.stringify(next));
      } catch { /* a lost column width is not worth surfacing */ }
    },
    [id],
  );

  const reset = useCallback(() => {
    setWidths({});
    try {
      localStorage.removeItem(widthKey(id));
    } catch { /* as above */ }
  }, [id]);

  // Once any column has been dragged the whole template becomes explicit:
  // mixing a dragged pixel width with fr units elsewhere makes the dragged
  // column snap back the moment the container resizes.
  const template = useMemo(() => {
    const any = columns.some((c) => widths[c.key]);
    return columns
      .map((c) => (any ? `${widths[c.key] ?? c.min}px` : c.track))
      .join(' ');
  }, [columns, widths]);

  return { widths, persist, reset, template, resized: columns.some((c) => widths[c.key]) };
}

export function GridHeader<K extends string>({
  columns,
  sort,
  onSort,
  widths,
  onResize,
  gridRef,
}: {
  columns: Column<K>[];
  sort: { key: K; dir: SortDir };
  onSort: (key: K) => void;
  widths: Record<string, number>;
  onResize: (next: Record<string, number>) => void;
  gridRef: React.RefObject<HTMLDivElement>;
}) {
  const drag = useRef<{ key: K; startX: number; startW: number; min: number } | null>(null);

  const beginDrag = (e: React.MouseEvent, column: Column<K>, cell: HTMLElement) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = {
      key: column.key,
      startX: e.clientX,
      startW: cell.getBoundingClientRect().width,
      min: column.min,
    };
    document.body.classList.add('lm-resizing');
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      // Freeze every column on the first drag, so the others keep the width
      // they are showing rather than reflowing around the one being dragged.
      const frozen: Record<string, number> = { ...widths };
      if (!columns.some((c) => widths[c.key])) {
        const cells = gridRef.current?.querySelectorAll('.lm-grid__hcell');
        cells?.forEach((cell, i) => {
          const key = columns[i]?.key;
          if (key) frozen[key] = cell.getBoundingClientRect().width;
        });
      }
      frozen[d.key] = Math.max(d.min, d.startW + (e.clientX - d.startX));
      onResize(frozen);
    };
    const onUp = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.classList.remove('lm-resizing');
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [columns, widths, onResize, gridRef]);

  return (
    <div className="lm-grid__head" role="row">
      {columns.map((c) => (
        <div
          key={c.key}
          role="columnheader"
          className={[
            'lm-grid__hcell',
            c.sortable ? 'lm-grid__hcell--sortable' : '',
            c.align === 'right' ? 'lm-grid__cell--right' : '',
            sort.key === c.key && sort.dir ? 'lm-grid__hcell--on' : '',
          ].join(' ')}
          onClick={c.sortable ? () => onSort(c.key) : undefined}
        >
          <span className="lm-grid__hlabel">{c.label}</span>
          {sort.key === c.key && sort.dir ? (
            <span className="lm-grid__caret" aria-hidden="true">{sort.dir === 'desc' ? '▾' : '▴'}</span>
          ) : null}
          <span
            className="lm-grid__resizer"
            title="Drag to resize"
            onMouseDown={(e) => beginDrag(e, c, e.currentTarget.parentElement as HTMLElement)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * One cell. Text that overflows is clipped; hovering slides it left by exactly
 * the overflow so the tail can be read, and the full value is on the title
 * attribute for anyone who would rather not wait for the animation.
 */
export function Cell({
  children,
  title,
  align,
  className,
}: {
  children: React.ReactNode;
  title?: string;
  align?: 'right';
  className?: string;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  const measure = () => {
    const node = textRef.current;
    if (!node) return;
    const overflow = node.scrollWidth - node.clientWidth;
    setShift(overflow > 1 ? overflow + 4 : 0);
  };

  return (
    <div
      className={[
        'lm-grid__cell',
        align === 'right' ? 'lm-grid__cell--right' : '',
        shift ? 'lm-grid__cell--slides' : '',
        className ?? '',
      ].join(' ')}
      title={title}
      onMouseEnter={measure}
      onMouseLeave={() => setShift(0)}
      style={shift ? ({ '--lm-shift': `-${shift}px` } as React.CSSProperties) : undefined}
    >
      <span className="lm-grid__text" ref={textRef}>
        {children}
      </span>
    </div>
  );
}

/**
 * Grows `limit` as the sentinel comes into view. Rendering a whole library at
 * once locks the page for seconds; this keeps the list to what has been
 * scrolled to, in the spirit of MyTube's batches of 40.
 */
export function useInfiniteScroll(
  total: number,
  limit: number,
  setLimit: (fn: (n: number) => number) => void,
  step: number,
) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || limit >= total) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + step);
      },
      { rootMargin: '600px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [total, limit, setLimit, step]);
  return sentinel;
}
