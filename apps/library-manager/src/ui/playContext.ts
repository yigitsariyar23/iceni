// Which context a track should be played from.
//
// Playing a track on its own leaves the queue with one item in it: the song
// ends and Spotify picks something of its own. Playing it *from* a playlist
// means what follows is the rest of that playlist, which is what double
// clicking a row in any music library does.
//
// Free of Spicetify so the choice can be tested under Node.

import type { PlaylistFilters } from './playlistFilter';

export interface PlayTarget {
  /** The context to play, or null to play the track by itself. */
  contextUri: string | null;
  trackUri: string;
}

/**
 * Prefers the playlist the user is actually looking at.
 *
 * With a playlist filter on, the rows on screen are there because of it, so
 * that is the context the row belongs to as far as anyone reading the list is
 * concerned. Otherwise it is the track's own first playlist, and failing that
 * Liked Songs -- a liked track with no playlist still has somewhere to
 * continue from. A track in neither plays alone, which is the old behaviour
 * and the only honest option left.
 */
export function choosePlayContext({
  trackUri,
  playlists,
  liked,
  filters,
  likedSongsUri,
}: {
  trackUri: string;
  /** Playlist uris the track sits in. */
  playlists: string[];
  liked: boolean;
  filters: PlaylistFilters;
  likedSongsUri?: string | null;
}): PlayTarget {
  const included = Object.entries(filters)
    .filter(([, mode]) => mode === 1)
    .map(([uri]) => uri);

  const fromFilter = included.find((uri) => playlists.includes(uri));
  if (fromFilter) return { contextUri: fromFilter, trackUri };

  if (playlists.length) return { contextUri: playlists[0]!, trackUri };
  if (liked && likedSongsUri) return { contextUri: likedSongsUri, trackUri };
  return { contextUri: null, trackUri };
}
