// Include / exclude filtering by playlist.
//
// Its own module, free of Spicetify, so the rule can be tested under Node.
// The distinction that matters: excluding a playlist keeps tracks that are in
// other playlists, and keeps unfiled ones too. It is "not in that one", not
// "in none".

import type { TrackRef } from '../api/scan';

export interface PlaylistFilter {
  uri: string;
  /** 1 keeps what is in it, -1 keeps what is not. */
  mode: 1 | -1;
}

export function applyPlaylistFilter(rows: TrackRef[], filter: PlaylistFilter | null): TrackRef[] {
  if (!filter) return rows;
  return filter.mode === 1
    ? rows.filter((r) => r.playlists.includes(filter.uri))
    : rows.filter((r) => !r.playlists.includes(filter.uri));
}
