// Persisting the scan between visits.
//
// A full scan is tens of requests and several seconds, and the library does
// not change while you are not looking at it, so paying that on every visit to
// the page is wasted. The scan is written to localStorage and reloaded on
// open; rescanning is a button.
//
// Rows are stored as tuples rather than objects. The object form of a scan of
// this size runs to a couple of megabytes of JSON, which is close enough to
// the storage quota to matter; the tuple form is roughly half that. The layout
// is documented here and nowhere else, so the two functions below must be read
// together.

import type { ScanResult, ScannedPlaylist } from './scan';

const KEY = 'iceni:library-manager:scan';

/** Bump when the tuple layout changes; an older payload is dropped, not read. */
const VERSION = 1;

// [uri, name, artists, album, albumUri, durationMs, flags, addedAtMs, uid]
type Row = [string, string, string, string, string, number, number, number, string?];

/** Artist names are joined on a control character: it cannot occur in a name,
 *  unlike the comma-space the UI displays them with. */
const ARTIST_SEP = '\u0001';

const PLAYABLE = 1;
const LOCAL = 2;
const EXPLICIT = 4;

interface Payload {
  v: number;
  at: number;
  folderCount: number;
  emptyFolders: string[];
  liked: Row[];
  playlists: Array<{
    u: string;
    n: string;
    f: string[];
    o: boolean;
    d?: string;
    t: Row[];
  }>;
}

const pack = (t: LibraryTrack, uid?: string): Row => {
  const flags =
    (t.isPlayable !== false ? PLAYABLE : 0) |
    (t.isLocal ? LOCAL : 0) |
    (t.isExplicit ? EXPLICIT : 0);
  const row: Row = [
    t.uri,
    t.name,
    (t.artists ?? []).map((a) => a.name).join(ARTIST_SEP),
    t.album?.name ?? '',
    t.album?.uri ?? '',
    t.duration?.milliseconds ?? 0,
    flags,
    t.addedAt ? Date.parse(t.addedAt) || 0 : 0,
  ];
  if (uid) row[8] = uid;
  return row;
};

const unpack = (r: Row): PlaylistTrack => ({
  type: 'track',
  uri: r[0],
  name: r[1],
  artists: r[2] ? r[2].split(ARTIST_SEP).map((name) => ({ type: 'artist', uri: '', name })) : [],
  album: { type: 'album', uri: r[4], name: r[3] },
  duration: { milliseconds: r[5] },
  discNumber: 0,
  trackNumber: 0,
  isPlayable: (r[6] & PLAYABLE) !== 0,
  isLocal: (r[6] & LOCAL) !== 0,
  isExplicit: (r[6] & EXPLICIT) !== 0,
  addedAt: r[7] ? new Date(r[7]).toISOString() : '',
  uid: r[8] ?? '',
});

export function saveScan(scan: ScanResult): void {
  const payload: Payload = {
    v: VERSION,
    at: scan.scannedAt,
    folderCount: scan.folderCount,
    emptyFolders: scan.emptyFolders,
    liked: scan.liked.map((t) => pack(t)),
    playlists: scan.playlists.map((p) => ({
      u: p.uri,
      n: p.name,
      f: p.folders,
      o: p.isOwnedBySelf,
      ...(p.description ? { d: p.description } : {}),
      t: p.tracks.map((t) => pack(t, t.uid)),
    })),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch (e) {
    // Almost always the quota on a very large library. Not fatal: the page
    // works from the in-memory scan, it just will not survive a reload.
    console.warn('[library-manager] could not cache the scan', e);
    try {
      localStorage.removeItem(KEY);
    } catch { /* nothing further to try */ }
  }
}

export function loadScan(): ScanResult | null {
  let payload: Payload;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    payload = JSON.parse(raw) as Payload;
  } catch (e) {
    console.warn('[library-manager] cached scan unreadable', e);
    return null;
  }
  if (!payload || payload.v !== VERSION || !Array.isArray(payload.playlists)) return null;

  const playlists: ScannedPlaylist[] = payload.playlists.map((p) => ({
    uri: p.u,
    name: p.n,
    folders: p.f ?? [],
    isOwnedBySelf: !!p.o,
    description: p.d,
    tracks: (p.t ?? []).map(unpack),
  }));

  return {
    scannedAt: payload.at,
    liked: (payload.liked ?? []).map(unpack),
    playlists,
    folderCount: payload.folderCount ?? 0,
    emptyFolders: payload.emptyFolders ?? [],
  };
}

export function clearScan(): void {
  try {
    localStorage.removeItem(KEY);
  } catch { /* nothing to do */ }
}

/** "3 minutes ago" for the header, so the age of the data is never a mystery. */
export function describeAge(scannedAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - scannedAt) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
