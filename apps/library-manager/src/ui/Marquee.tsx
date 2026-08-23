// Rubber-band selection.
//
// Press on empty space in the list and drag: a band follows the pointer and
// every row it touches is selected. Holding shift or ctrl/cmd adds to the
// existing selection instead of replacing it, which is what every file manager
// does.
//
// A press that never moves is a click, not a drag, so nothing starts until the
// pointer has travelled a few pixels -- otherwise every click on a row would
// clear the selection through the band instead of through the row handler.

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
      // Left button only, and never from a control or a row: those have their
      // own handlers, and a drag starting on a row would fight them.
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('button, input, select, a, [role="row"]')) return;
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
      if (drag.current?.live) document.body.classList.remove('lm-marqueeing');
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
    <div
      className="lm-marquee"
      style={{ left: band.left, top: band.top, width: band.width, height: band.height }}
    />
  );
}
