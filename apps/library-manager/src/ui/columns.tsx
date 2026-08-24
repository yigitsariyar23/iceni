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
import { navigateTo } from '../api/platform';
import { fmtCompact, fmtDate, fmtInt, fmtTrackLength } from './format';

export type ColKey =
  | 'name' | 'artist' | 'album' | 'playlists' | 'playlistNames'
  | 'length' | 'added' | 'plays' | 'liked' | 'playable' | 'explicit' | 'local' | 'uri';

export interface ColumnDef {
  key: ColKey;
  label: string;
  /** Grid track for the default layout. */
  track: string;
  min: number;
  align?: 'right';
  on: boolean;
  /** Sort key; a column without one is not sortable. */
  sortBy?: (t: TrackRef, ctx: ColumnContext) => string | number;
  render: (t: TrackRef, ctx: ColumnContext) => React.ReactNode;
  title?: (t: TrackRef, ctx: ColumnContext) => string;
}

export interface ColumnContext {
  /** Playlist uri -> name, for the columns that show where a track sits. */
  names: Map<string, string>;
  /** Track uri -> global play count; empty until the weekly fetch has run. */
  plays: Record<string, number>;
}

const yes = (v: boolean) => (v ? '●' : '');

/**
 * An entity name that navigates. Kept out of the row's own click handling:
 * a link click must not also toggle the row's selection on the way past.
 */
function EntityLink({ name, uri }: { name: string; uri: string }) {
  if (!uri) return <>{name}</>;
  return (
    <button
      type="button"
      className="lm-entity"
      onClick={(e) => {
        e.stopPropagation();
        navigateTo(uri);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {name}
    </button>
  );
}

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
    render: (t) => (t.artists.length
      ? t.artists.map((a, i) => (
          <Spicetify.React.Fragment key={a.uri || a.name}>
            {i ? ', ' : null}
            <EntityLink name={a.name} uri={a.uri} />
          </Spicetify.React.Fragment>
        ))
      : t.artistNames),
  },
  {
    key: 'album', label: 'Album', track: 'minmax(140px, 1.1fr)', min: 90, on: true,
    sortBy: (t) => t.albumName.toLowerCase(),
    title: (t) => t.albumName,
    render: (t) => <EntityLink name={t.albumName} uri={t.albumUri} />,
  },
  {
    key: 'playlists', label: 'Playlists', track: '84px', min: 66, align: 'right', on: true,
    sortBy: (t) => t.playlists.length,
    title: (t, { names }) => t.playlists.map((u) => names.get(u) ?? u).join('\n'),
    render: (t) => t.playlists.length,
  },
  {
    // The count answers "how filed is this"; the names answer "where is it",
    // which is the question you have when deciding whether to remove a copy.
    key: 'playlistNames', label: 'In playlists', track: 'minmax(160px, 1.2fr)', min: 100, on: false,
    sortBy: (t) => t.playlists.length,
    title: (t, { names }) => t.playlists.map((u) => names.get(u) ?? u).join('\n'),
    render: (t, { names }) => t.playlists.map((uri, i) => (
      <Spicetify.React.Fragment key={uri}>
        {i ? ', ' : null}
        <EntityLink name={names.get(uri) ?? uri} uri={uri} />
      </Spicetify.React.Fragment>
    )),
  },
  {
    key: 'length', label: 'Length', track: '74px', min: 60, align: 'right', on: true,
    sortBy: (t) => t.durationMs,
    render: (t) => fmtTrackLength(t.durationMs),
  },
  {
    key: 'added', label: 'Added', track: '104px', min: 84, align: 'right', on: true,
    sortBy: (t) => t.addedAt,
    title: (t) => (t.addedAt ? new Date(t.addedAt).toLocaleString() : ''),
    render: (t) => fmtDate(t.addedAt),
  },
  {
    // Spotify's public figure -- how often everyone has played the track. Your
    // own count is not exposed by the client at all.
    key: 'plays', label: 'Plays', track: '84px', min: 62, align: 'right', on: true,
    sortBy: (t, { plays }) => plays[t.uri] ?? -1,
    title: (t, { plays }) => (plays[t.uri] ? `${fmtInt(plays[t.uri]!)} plays worldwide` : ''),
    render: (t, { plays }) => fmtCompact(plays[t.uri] ?? 0),
  },
  {
    key: 'liked', label: 'Liked', track: '60px', min: 52, align: 'right', on: false,
    sortBy: (t) => (t.liked ? 1 : 0),
    render: (t) => (t.liked ? '♥' : ''),
  },
  {
    // Named "Plays" once, which collided with the play-count column and read
    // as a second empty copy of it.
    key: 'playable', label: 'Playable', track: '74px', min: 60, align: 'right', on: false,
    sortBy: (t) => (t.isPlayable ? 1 : 0),
    title: (t) => (t.isPlayable ? 'Plays here' : 'Unplayable here'),
    render: (t) => (t.isPlayable ? '✓' : '✕'),
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

/** The old key held the visible set; see the note on loadVisible. */
const LEGACY_KEY = 'iceni:library-manager:columns';
const HIDDEN_KEY = 'iceni:library-manager:columns-hidden';

const defaults = () => COLUMNS.filter((c) => c.on).map((c) => c.key);
const known = (k: unknown): k is ColKey => COLUMNS.some((c) => c.key === k);

/**
 * What is stored is the set the user has turned *off*, not the set they have
 * left on.
 *
 * Storing the visible set meant a column added in a later build could never
 * appear for anyone who had opened the picker once: their saved list did not
 * mention it, so it read as hidden forever. Storing the hidden set inverts
 * that -- a new column is shown unless it was explicitly switched off, which
 * is the behaviour anyone would expect.
 *
 * A list saved under the old key is converted the first time it is read.
 */
export function loadVisible(): ColKey[] {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const saved = (JSON.parse(legacy) as unknown[]).filter(known);
      localStorage.removeItem(LEGACY_KEY);
      if (saved.length) {
        // Anything the old list did not mention becomes hidden -- except
        // columns added since, which the user never had the chance to judge.
        const hidden = COLUMNS
          .filter((c) => !saved.includes(c.key) && !c.on)
          .map((c) => c.key);
        saveHidden(hidden);
        return COLUMNS.filter((c) => !hidden.includes(c.key)).map((c) => c.key);
      }
    }

    const raw = localStorage.getItem(HIDDEN_KEY);
    const hidden = raw ? (JSON.parse(raw) as unknown[]).filter(known) : null;
    if (!hidden) return defaults();
    const visible = COLUMNS.filter((c) => !hidden.includes(c.key)).map((c) => c.key);
    // Never leave the grid with no columns at all: the template collapses and
    // the rows render as a blank strip.
    return visible.length ? visible : defaults();
  } catch {
    return defaults();
  }
}

function saveHidden(hidden: ColKey[]): void {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
  } catch { /* a lost column preference is not worth surfacing */ }
}

export function saveVisible(keys: ColKey[]): void {
  saveHidden(COLUMNS.filter((c) => !keys.includes(c.key)).map((c) => c.key));
}
