// Include / exclude filtering by playlist, across any number of them.
//
// Its own module, free of Spicetify, so the combining rules can be tested
// under Node. Two decisions are encoded here and neither is self-evident:
//
//   Includes are OR. With Rock and Metal both included, a track in either one
//   qualifies. This is how faceted search behaves everywhere -- choices within
//   one facet widen the result, choices across facets narrow it -- and "in
//   both at once" is a question the Playlists count column already answers.
//
//   Excludes are AND. Excluding Rock and Metal means in neither of them. An
//   exclusion that only had to miss one of the two would not exclude anything.
//
// And excluding a playlist is "not in that one", not "in none": a track filed
// somewhere else survives, and so does an unfiled one.

import type { TrackRef } from '../api/scan';

/** Playlist uri -> 1 to keep what is in it, -1 to keep what is not. */
export type PlaylistFilters = Record<string, 1 | -1>;

export function splitFilters(filters: PlaylistFilters) {
  const included: string[] = [];
  const excluded: string[] = [];
  for (const [uri, mode] of Object.entries(filters)) {
    (mode === 1 ? included : excluded).push(uri);
  }
  return { included, excluded };
}

export function applyPlaylistFilter(rows: TrackRef[], filters: PlaylistFilters): TrackRef[] {
  const { included, excluded } = splitFilters(filters);
  if (!included.length && !excluded.length) return rows;
  return rows.filter((r) => {
    if (included.length && !included.some((uri) => r.playlists.includes(uri))) return false;
    return !excluded.some((uri) => r.playlists.includes(uri));
  });
}

/** Left click walks to include, right click to exclude; the same state clears. */
export function nextMode(
  current: 1 | -1 | undefined,
  wanted: 1 | -1,
): 1 | -1 | undefined {
  return current === wanted ? undefined : wanted;
}

export function withMode(
  filters: PlaylistFilters,
  uri: string,
  mode: 1 | -1 | undefined,
): PlaylistFilters {
  const next = { ...filters };
  if (mode) next[uri] = mode;
  else delete next[uri];
  return next;
}
