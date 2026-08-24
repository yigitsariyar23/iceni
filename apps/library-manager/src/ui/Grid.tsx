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

import { clampColumnWidth } from './gridWidth';

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

  /**
   * The column that absorbs whatever is left over, so the row always ends
   * exactly at the edge: no trailing dead space, and no overflow when the
   * window is narrower than the widths were chosen for.
   *
   * It is the first column with an elastic default that has *not* been
   * dragged. Pinning it to the first elastic column outright meant dragging
   * that column did nothing -- its stored width was overwritten by the
   * remainder every render -- so dragging one hands the job to the next
   * elastic column along. If every elastic column has been set by hand, the
   * last column takes the remainder rather than leaving a gap.
   *
   * It must not be a column whose content is right-aligned by choice: handing
   * the remainder to the last column when that was Plays left its figures
   * marooned at the window edge across a strip of empty space.
   */
  const flexibleKey = useMemo(() => {
    const elastic = columns.filter((c) => c.track.includes('fr'));
    const last = <T,>(arr: T[]): T | undefined => arr[arr.length - 1];
    return (elastic.find((c) => !widths[c.key]) ?? last(elastic) ?? last(columns))?.key;
  }, [columns, widths]);

  // Once any column has been dragged the whole template becomes explicit:
  // mixing a dragged pixel width with fr units elsewhere makes the dragged
  // column snap back the moment the container resizes.
  const template = useMemo(() => {
    const any = columns.some((c) => widths[c.key]);
    if (!any) return columns.map((c) => c.track).join(' ');

    return columns
      .map((c) =>
        c.key === flexibleKey
          ? `minmax(${c.min}px, 1fr)`
          : `${widths[c.key] ?? c.min}px`)
      .join(' ');
  }, [columns, widths, flexibleKey]);

  return { widths, persist, reset, template, flexibleKey, resized: columns.some((c) => widths[c.key]) };
}

export function GridHeader<K extends string>({
  columns,
  sort,
  onSort,
  widths,
  onResize,
  onReorder,
  flexibleKey,
  gridRef,
}: {
  columns: Column<K>[];
  sort: { key: K; dir: SortDir };
  onSort: (key: K) => void;
  widths: Record<string, number>;
  onResize: (next: Record<string, number>) => void;
  /** Counted at its minimum when clamping: it is the space a drag grows into. */
  flexibleKey?: K;
  /** `to` is an index into the current column list, gaps counted from the left. */
  onReorder?: (key: K, to: number) => void;
  gridRef: React.RefObject<HTMLDivElement>;
}) {
  const drag = useRef<{ key: K; startX: number; startW: number; min: number } | null>(null);
  const move = useRef<{ key: K; startX: number; live: boolean } | null>(null);
  const [dragging, setDragging] = useState<K | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

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

  // ── Reordering ─────────────────────────────────────────────────────
  // Pressing the body of a header and dragging moves the column; pressing the
  // handle at its edge resizes it. The handle stops propagation, so the two
  // never both start.
  const beginMove = (e: React.MouseEvent, column: Column<K>) => {
    if (!onReorder || e.button !== 0) return;
    move.current = { key: column.key, startX: e.clientX, live: false };
  };

  /** The gap the pointer is nearest, counted from the left edge of the row. */
  const dropIndexAt = (clientX: number): number => {
    const cells = gridRef.current?.querySelectorAll('.lm-grid__hcell');
    if (!cells?.length) return 0;
    for (let i = 0; i < cells.length; i++) {
      const r = cells[i]!.getBoundingClientRect();
      if (clientX < r.left + r.width / 2) return i;
    }
    return cells.length;
  };

  useEffect(() => {
    if (!onReorder) return undefined;
    const onMove = (e: MouseEvent) => {
      const m = move.current;
      if (!m) return;
      if (!m.live && Math.abs(e.clientX - m.startX) < 5) return;
      if (!m.live) {
        m.live = true;
        setDragging(m.key);
        document.body.classList.add('lm-reordering');
      }
      e.preventDefault();
      setDropAt(dropIndexAt(e.clientX));
    };
    const onUp = (e: MouseEvent) => {
      const m = move.current;
      move.current = null;
      if (!m?.live) return;
      document.body.classList.remove('lm-reordering');
      setDragging(null);
      setDropAt(null);
      onReorder(m.key, dropIndexAt(e.clientX));
      // The mouseup is followed by a click on the header, which would sort it.
      const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, true), 0);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onReorder, columns, gridRef]);

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
      // Clamped so the row always fits: without a ceiling a column could be
      // dragged past the window, and the grid would keep laying out at the
      // width it was told, pushing the far columns off the edge.
      //
      // The flexible column counts at its minimum, not at the width it happens
      // to be showing. Counting it at its current width made the sum of the
      // others equal the whole row, so the ceiling landed on the dragged
      // column's own width and nothing could ever be made wider -- only
      // narrower. Growing a column means taking the space from the one that
      // absorbs the remainder, so that is the space the ceiling has to offer.
      frozen[d.key] = clampColumnWidth({
        wanted: Math.max(d.min, d.startW + (e.clientX - d.startX)),
        columns,
        widths: frozen,
        draggedKey: d.key,
        flexibleKey,
        containerWidth: gridRef.current?.clientWidth ?? 0,
      });
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
  }, [columns, widths, onResize, gridRef, flexibleKey]);

  return (
    <div className="lm-grid__head" role="row">
      {columns.map((c, i) => (
        <div
          key={c.key}
          role="columnheader"
          className={[
            'lm-grid__hcell',
            c.sortable ? 'lm-grid__hcell--sortable' : '',
            c.align === 'right' ? 'lm-grid__cell--right' : '',
            sort.key === c.key && sort.dir ? 'lm-grid__hcell--on' : '',
            dragging === c.key ? 'lm-grid__hcell--moving' : '',
          ].join(' ')}
          onMouseDown={(e) => beginMove(e, c)}
          onClick={c.sortable ? () => onSort(c.key) : undefined}
        >
          {dropAt === i ? <span className="lm-grid__drop" aria-hidden="true" /> : null}
          {dropAt === columns.length && i === columns.length - 1 ? (
            <span className="lm-grid__drop lm-grid__drop--end" aria-hidden="true" />
          ) : null}
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
