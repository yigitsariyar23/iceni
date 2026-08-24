// How wide a dragged column is allowed to become.
//
// Its own module, free of Spicetify and of the DOM, because this arithmetic is
// where resizing broke: counting the flexible column at its current width made
// the other columns' total equal the whole row, so the ceiling landed on the
// dragged column's own width and nothing could ever be made wider.

/** Matches the gap and padding on .lm-grid__row in style.css. */
export const GAP = 14;
export const EDGE = 10;

/** Everything in a row that is not a column. */
export const gutters = (count: number) => Math.max(0, count - 1) * GAP + EDGE * 2;

export interface Sizable {
  key: string;
  min: number;
}

/**
 * The width to give the dragged column: what the pointer asks for, floored at
 * the column's minimum and capped at what is left once every other column has
 * taken its share.
 *
 * The flexible column -- the one that absorbs the remainder -- is counted at
 * its minimum rather than at what it is showing. Growing a column means taking
 * the space from that one, so that space has to be on offer.
 */
export function clampColumnWidth({
  wanted,
  columns,
  widths,
  draggedKey,
  flexibleKey,
  containerWidth,
}: {
  wanted: number;
  columns: Sizable[];
  widths: Record<string, number>;
  draggedKey: string;
  flexibleKey?: string;
  containerWidth: number;
}): number {
  const dragged = columns.find((c) => c.key === draggedKey);
  const min = dragged?.min ?? 0;
  const others = columns.reduce((sum, c) => {
    if (c.key === draggedKey) return sum;
    return sum + (c.key === flexibleKey ? c.min : widths[c.key] ?? c.min);
  }, 0);
  const available = containerWidth - gutters(columns.length) - others;
  return Math.max(min, Math.min(wanted, available));
}
