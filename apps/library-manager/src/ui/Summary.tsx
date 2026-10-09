// The row summary at the end of the filter bar, as chips rather than a
// sentence.
//
// It read "12,345 of 20,000 tracks · 12 removed · 3 selected": three numbers
// and a dozen words of scaffolding, in a bar that already wraps onto a second
// line on a narrow window. The numbers are the part anyone reads, so they are
// what is left. Each chip keeps the sentence as its tooltip, and none of them
// is the only way to learn what it counts -- the filters, the Removed button
// and the selection itself all say so in words elsewhere.

import { fmtInt } from './format';

/** One stroke weight for all three, so they read as a set at 13px. */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Rows: the list glyph, matching the grid it counts. */
const RowsIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.75 4h10.5M2.75 8h10.5M2.75 12h10.5" {...stroke} />
  </svg>
);

/**
 * Removed: a minus in a circle, for rows excluded from the list.
 *
 * A struck-through eye is the obvious glyph and was the first attempt, but at
 * 13px the slash runs through the pupil and the whole thing collapses into a
 * smudge; dropping the pupil only turns it into an empty-set sign. This one
 * survives the size, and "exclude" is the word the bar already uses -- it is
 * the state the facets and the Removed button itself sit in.
 */
const RemovedIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5.6" {...stroke} />
    <path d="M5.4 8h5.2" {...stroke} />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 8.6 6.4 12 13 4.6" {...stroke} />
  </svg>
);

export function Summary({
  shown,
  total,
  filtered,
  hidden,
  selected,
}: {
  /** Rows the grid is listing. */
  shown: number;
  /** Rows the filters ran against, which is not the library where the removed
   *  view is hiding some of it. */
  total: number;
  /** Whether any filter is on. Not `shown !== total`: a filter that happens to
   *  match everything is still a filter, and saying so is the point. */
  filtered: boolean;
  /** Removed rows kept out of `total`, or 0 when they are not being kept out
   *  -- under the other two views they are in the count above already. */
  hidden: number;
  selected: number;
}) {
  return (
    <span className="lm-count">
      <span
        className="lm-count__chip"
        title={filtered
          ? `${fmtInt(shown)} of ${fmtInt(total)} tracks match the filters`
          : `${fmtInt(total)} tracks`}
      >
        <RowsIcon />
        {filtered ? `${fmtInt(shown)} / ${fmtInt(total)}` : fmtInt(total)}
      </span>

      {hidden ? (
        <span
          className="lm-count__chip"
          title={`${fmtInt(hidden)} removed from Browse, and not counted above`}
        >
          <RemovedIcon />
          {fmtInt(hidden)}
        </span>
      ) : null}

      {selected ? (
        <span
          className="lm-count__chip lm-count__chip--on"
          title={`${fmtInt(selected)} selected`}
        >
          <CheckIcon />
          {fmtInt(selected)}
        </span>
      ) : null}
    </span>
  );
}
