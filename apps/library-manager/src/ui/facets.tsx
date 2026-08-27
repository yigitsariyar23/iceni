// Tri-state filter buttons.
//
// These replace a single "Everything / Liked / Unfiled / Unplayable" dropdown,
// which could only ever express one condition and had no way to say "not".
// Each facet here is its own button with three states, and they combine:
//
//   neutral   the facet is not part of the filter
//   include   left click  -- keep only rows the facet matches
//   exclude   right click -- keep only rows it does not
//
// So "liked but not filed" is two clicks rather than a dropdown entry someone
// had to think of in advance, and "unfiled and unplayable" is possible at all.
//
// Filed is measured against the playlists the user has *not* filtered to.
// Narrowing to Rock and then asking for Unfiled would otherwise be a
// contradiction -- every row left is in Rock, so nothing is unfiled and the
// grid empties. Ignoring the included playlists makes the pair say the useful
// thing instead: Unfiled is "in Rock and nowhere else", Filed is "in Rock and
// somewhere else too". With no playlist filter on, nothing is ignored and both
// mean exactly what they did before.

import type { TrackRef } from '../api/scan';

export type FacetKey = 'liked' | 'filed' | 'playable' | 'explicit' | 'local';

/** 1 include, -1 exclude, absent neutral. */
export type FacetState = Record<FacetKey, 1 | -1>;

export interface Facet {
  key: FacetKey;
  /** Shown while including, and while neutral. */
  on: string;
  /** Shown while excluding, so the button always reads as what it does. */
  off: string;
  /**
   * `ignored` holds the playlists the playlist filter has already narrowed to;
   * only `filed` has any reason to look at it.
   */
  test: (t: TrackRef, ignored: ReadonlySet<string>) => boolean;
}

const NOTHING_IGNORED: ReadonlySet<string> = new Set();

export const FACETS: Facet[] = [
  { key: 'liked', on: 'Liked', off: 'Not liked', test: (t) => t.liked },
  {
    key: 'filed',
    on: 'Filed',
    off: 'Unfiled',
    test: (t, ignored) => t.playlists.some((uri) => !ignored.has(uri)),
  },
  { key: 'playable', on: 'Playable', off: 'Unplayable', test: (t) => t.isPlayable },
  { key: 'explicit', on: 'Explicit', off: 'Clean', test: (t) => t.isExplicit },
  { key: 'local', on: 'Local file', off: 'Not local', test: (t) => t.isLocal },
];

export function applyFacets(
  rows: TrackRef[],
  state: Partial<FacetState>,
  /** Playlists the filter has narrowed to, which no longer count as filing. */
  ignored: ReadonlySet<string> = NOTHING_IGNORED,
): TrackRef[] {
  const active = FACETS.filter((f) => state[f.key]);
  if (!active.length) return rows;
  return rows.filter((row) =>
    active.every((f) => (state[f.key] === 1 ? f.test(row, ignored) : !f.test(row, ignored))),
  );
}

/**
 * Left click walks neutral -> include -> neutral; right click walks
 * neutral -> exclude -> neutral. Either click from the opposite state moves
 * straight to the one asked for rather than through neutral, so a facet can be
 * flipped without a detour.
 */
export function nextFacet(current: 1 | -1 | undefined, wanted: 1 | -1): 1 | -1 | undefined {
  return current === wanted ? undefined : wanted;
}

export function FacetButton({
  facet,
  state,
  note,
  onChange,
}: {
  facet: Facet;
  state: 1 | -1 | undefined;
  /** Appended to the tooltip when the facet means something narrower than usual. */
  note?: string;
  onChange: (next: 1 | -1 | undefined) => void;
}) {
  const label = state === -1 ? facet.off : facet.on;
  return (
    <button
      type="button"
      className={[
        'lm-facet',
        state === 1 ? 'lm-facet--in' : '',
        state === -1 ? 'lm-facet--out' : '',
      ].join(' ')}
      aria-pressed={!!state}
      title={
        (state === 1 ? `Only ${facet.on.toLowerCase()} — click again to clear`
          : state === -1 ? `Only ${facet.off.toLowerCase()} — right click again to clear`
            : `Click for ${facet.on.toLowerCase()}, right click for ${facet.off.toLowerCase()}`)
        + (note ? `\n${note}` : '')
      }
      onClick={() => onChange(nextFacet(state, 1))}
      onContextMenu={(e) => {
        e.preventDefault();
        // Stopped as well as prevented: the grid below opens its own menu on
        // right click, and this one must not reach it.
        e.stopPropagation();
        onChange(nextFacet(state, -1));
      }}
    >
      {label}
    </button>
  );
}
