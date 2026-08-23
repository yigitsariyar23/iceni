// Rubber-band selection.
//
// Press on empty space in the list and drag: a band follows the pointer and
// every row it touches is selected. Holding shift or ctrl/cmd adds to the
// existing selection instead of replacing it, which is what every file manager
// does.
//
// A press that never moves is a click, not a drag, so nothing starts until the
// pointer has travelled a few pixels. A press that does turn into a drag has to
// swallow the click that follows it, or releasing over a row would immediately
// replace the band's whole selection with that one row.
//
// The band deliberately starts on rows as well as on empty space: a list this
// dense has no empty space to speak of, so refusing to start on a row -- which
// is what the first version did -- meant it could never start at all.

import { Portal } from './Portal';

const { useCallback, useEffect, useRef, useState } = Spicetify.React;

const THRESHOLD = 4;

export interface Band {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function useMarquee({
  containerRef,
  rowSelector,
  onSelect,
}: {
  containerRef: React.RefObject<HTMLElement>;
  /** Rows must carry a data-uri; that is what comes back in onSelect. */
  rowSelector: string;
  onSelect: (uris: string[], additive: boolean) => void;
}) {
  const [band, setBand] = useState<Band | null>(null);
  const drag = useRef<{ x: number; y: number; additive: boolean; live: boolean } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Left button only, and never from a control: a checkbox or a link has
      // its own handling and must not be hijacked into a drag.
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('button, input, select, textarea, a')) return;
      drag.current = { x: e.clientX, y: e.clientY, additive: e.shiftKey || e.metaKey || e.ctrlKey, live: false };
    },
    [],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.live && Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
      if (!d.live) {
        d.live = true;
        document.body.classList.add('lm-marqueeing');
      }
      e.preventDefault();

      const next: Band = {
        left: Math.min(d.x, e.clientX),
        top: Math.min(d.y, e.clientY),
        width: Math.abs(dx),
        height: Math.abs(dy),
      };
      setBand(next);

      const hits: string[] = [];
      const rows = containerRef.current?.querySelectorAll<HTMLElement>(rowSelector);
      rows?.forEach((row) => {
        const r = row.getBoundingClientRect();
        const overlaps =
          r.left < next.left + next.width &&
          r.right > next.left &&
          r.top < next.top + next.height &&
          r.bottom > next.top;
        const uri = row.dataset.uri;
        if (overlaps && uri) hits.push(uri);
      });
      // Reported on every move rather than only at the end, so the selection
      // is visible while the band is still being dragged.
      onSelect(hits, d.additive);
    };

    const onUp = () => {
      if (drag.current?.live) {
        document.body.classList.remove('lm-marqueeing');
        // The mouseup is followed by a click on whatever the pointer is over.
        // Left alone, a row's own handler would take it and collapse the
        // selection the band just made down to that single row.
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        document.addEventListener('click', swallow, { capture: true, once: true });
        // If no click follows -- the pointer ended outside any handler -- the
        // one-shot listener would sit there and eat the next real click.
        setTimeout(() => document.removeEventListener('click', swallow, true), 0);
      }
      drag.current = null;
      setBand(null);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [containerRef, rowSelector, onSelect]);

  return { band, onMouseDown };
}

export function MarqueeBox({ band }: { band: Band | null }) {
  if (!band || (band.width < THRESHOLD && band.height < THRESHOLD)) return null;
  return (
    <Portal>
      <div
        className="lm-marquee"
        style={{ left: band.left, top: band.top, width: band.width, height: band.height }}
      />
    </Portal>
  );
}
