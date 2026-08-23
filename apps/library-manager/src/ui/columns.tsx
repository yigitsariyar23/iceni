// The column catalogue.
//
// Which columns exist, what each one renders, and how it sorts. Every column
// here can be turned off, and the choice is remembered; the six marked
// `on: true` are what a fresh install shows.
//
// Only fields the client actually populates are offered. bpm, key, release
// date and audio analysis all appear on the track objects and are all empty in
// practice -- measured across the liked-songs list -- so there are no columns
// for them; a column that is always "—" is worse than no column.

import type { TrackRef } from '../api/scan';
import { fmtDate, fmtDuration } from './format';

export type ColKey =
  | 'name' | 'artist' | 'album' | 'playlists' | 'playlistNames'
  | 'length' | 'added' | 'liked' | 'playable' | 'explicit' | 'local' | 'uri';

export interface ColumnDef {
  key: ColKey;
  label: string;
  /** Grid track for the default layout. */
  track: string;
  min: number;
  align?: 'right';
  on: boolean;
  /** Sort key; a column without one is not sortable. */
  sortBy?: (t: TrackRef) => string | number;
  render: (t: TrackRef, names: Map<string, string>) => React.ReactNode;
  title?: (t: TrackRef, names: Map<string, string>) => string;
}

const yes = (v: boolean) => (v ? '●' : '');

export const COLUMNS: ColumnDef[] = [
  {
    key: 'name', label: 'Track', track: 'minmax(180px, 1.7fr)', min: 110, on: true,
    sortBy: (t) => t.name.toLowerCase(),
    title: (t) => t.name,
    render: (t) => t.name,
  },
  {
    key: 'artist', label: 'Artist', track: 'minmax(140px, 1.1fr)', min: 90, on: true,
    sortBy: (t) => t.artistNames.toLowerCase(),
    title: (t) => t.artistNames,
    render: (t) => t.artistNames,
  },
  {
    key: 'album', label: 'Album', track: 'minmax(140px, 1.1fr)', min: 90, on: true,
    sortBy: (t) => t.albumName.toLowerCase(),
    title: (t) => t.albumName,
    render: (t) => t.albumName,
  },
  {
    key: 'playlists', label: 'Playlists', track: '84px', min: 66, align: 'right', on: true,
    sortBy: (t) => t.playlists.length,
    title: (t, names) => t.playlists.map((u) => names.get(u) ?? u).join('\n'),
    render: (t) => t.playlists.length,
  },
  {
    // The count answers "how filed is this"; the names answer "where is it",
    // which is the question you have when deciding whether to remove a copy.
    key: 'playlistNames', label: 'In playlists', track: 'minmax(160px, 1.2fr)', min: 100, on: false,
    sortBy: (t) => t.playlists.length,
    title: (t, names) => t.playlists.map((u) => names.get(u) ?? u).join('\n'),
    render: (t, names) => t.playlists.map((u) => names.get(u) ?? u).join(', '),
  },
  {
    key: 'length', label: 'Length', track: '74px', min: 60, align: 'right', on: true,
    sortBy: (t) => t.durationMs,
    render: (t) => fmtDuration(t.durationMs),
  },
  {
    key: 'added', label: 'Added', track: '104px', min: 84, align: 'right', on: true,
    sortBy: (t) => t.addedAt,
    title: (t) => (t.addedAt ? new Date(t.addedAt).toLocaleString() : ''),
    render: (t) => fmtDate(t.addedAt),
  },
  {
    key: 'liked', label: 'Liked', track: '60px', min: 52, align: 'right', on: false,
    sortBy: (t) => (t.liked ? 1 : 0),
    render: (t) => (t.liked ? '♥' : ''),
  },
  {
    key: 'playable', label: 'Plays', track: '60px', min: 52, align: 'right', on: false,
    sortBy: (t) => (t.isPlayable ? 1 : 0),
    title: (t) => (t.isPlayable ? '' : 'Unplayable here'),
    render: (t) => (t.isPlayable ? '' : '✕'),
  },
  {
    key: 'explicit', label: 'Explicit', track: '68px', min: 56, align: 'right', on: false,
    sortBy: (t) => (t.isExplicit ? 1 : 0),
    render: (t) => yes(t.isExplicit),
  },
  {
    key: 'local', label: 'Local', track: '60px', min: 52, align: 'right', on: false,
    sortBy: (t) => (t.isLocal ? 1 : 0),
    render: (t) => yes(t.isLocal),
  },
  {
    key: 'uri', label: 'URI', track: 'minmax(160px, 1fr)', min: 110, on: false,
    sortBy: (t) => t.uri,
    title: (t) => t.uri,
    render: (t) => t.uri,
  },
];

const VISIBLE_KEY = 'iceni:library-manager:columns';

export function loadVisible(): ColKey[] {
  try {
    const raw = localStorage.getItem(VISIBLE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as ColKey[];
      // Filter against the catalogue: a key from an older build that no longer
      // exists must not leave a hole in the grid template.
      const known = saved.filter((k) => COLUMNS.some((c) => c.key === k));
      if (known.length) return known;
    }
  } catch { /* fall through to the defaults */ }
  return COLUMNS.filter((c) => c.on).map((c) => c.key);
}

export function saveVisible(keys: ColKey[]): void {
  try {
    localStorage.setItem(VISIBLE_KEY, JSON.stringify(keys));
  } catch { /* a lost column preference is not worth surfacing */ }
}
