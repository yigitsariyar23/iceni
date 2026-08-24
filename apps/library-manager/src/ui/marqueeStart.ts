// Whether a press may begin a rubber-band selection.
//
// Its own module, free of Spicetify, so it can be tested under Node.
//
// The band used to start anywhere in the grid, header included, so pressing a
// column header began a reorder and a selection at the same time: the columns
// moved and every row the pointer crossed got selected on the way. A press has
// to land inside the region that actually holds rows.

export interface StartTarget {
  closest(selector: string): unknown;
}

/**
 * `within` is the region rows live in. A press outside it -- the header, the
 * filter bar, anything floating above -- is not a selection gesture.
 * Interactive controls are excluded wherever they are: a checkbox or a link
 * has its own handling and must not be hijacked into a drag.
 */
export function canStartMarquee(target: StartTarget | null, within: string): boolean {
  if (!target) return false;
  if (target.closest('button, input, select, textarea, a')) return false;
  return !!target.closest(within);
}
