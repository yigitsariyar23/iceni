// The filter bar, remembered between visits.
//
// The scan already survives a reload; the view onto it did not, so coming back
// to the page meant setting the same three filters up again. Free of Spicetify
// so the reconciliation can be tested under Node.

import { FACETS, type FacetKey, type FacetState } from './facets';
import type { PlaylistFilters } from './playlistFilter';
import type { ColKey } from './columns';
import { COLUMNS } from './columns';
import { isRemovedView, type RemovedView } from './removed';
import type { SortDir } from './Grid';

const KEY = 'iceni:library-manager:filters';
const VERSION = 1;

export interface FilterState {
  query: string;
  facets: Partial<FacetState>;
  playlists: PlaylistFilters;
  sort: { key: ColKey; dir: SortDir };
  /** Which side of the soft-delete line Browse is looking at. */
  removedView: RemovedView;
}

export const EMPTY: FilterState = {
  query: '',
  facets: {},
  playlists: {},
  sort: { key: 'added', dir: 'desc' },
  removedView: 'hide',
};

const isMode = (v: unknown): v is 1 | -1 => v === 1 || v === -1;

/**
 * Trims a stored state back to what still makes sense.
 *
 * `knownPlaylists` is the scan's current set: a filter naming a playlist that
 * has since been deleted would silently match nothing, and the chip for it
 * would show a raw uri. Facet keys and sort columns are checked the same way,
 * against their catalogues.
 */
export function reconcileFilters(
  stored: unknown,
  knownPlaylists: ReadonlySet<string>,
): FilterState {
  const raw = stored as Partial<FilterState> & { v?: number } | null;
  if (!raw || raw.v !== VERSION) return EMPTY;

  const facets: Partial<FacetState> = {};
  for (const [key, mode] of Object.entries(raw.facets ?? {})) {
    if (FACETS.some((f) => f.key === key) && isMode(mode)) facets[key as FacetKey] = mode;
  }

  const playlists: PlaylistFilters = {};
  for (const [uri, mode] of Object.entries(raw.playlists ?? {})) {
    if (knownPlaylists.has(uri) && isMode(mode)) playlists[uri] = mode;
  }

  const sortKey = COLUMNS.some((c) => c.key === raw.sort?.key)
    ? (raw.sort!.key as ColKey)
    : EMPTY.sort.key;
  const dir: SortDir = raw.sort?.dir === 'asc' || raw.sort?.dir === 'desc' || raw.sort?.dir === null
    ? raw.sort.dir
    : EMPTY.sort.dir;

  return {
    query: typeof raw.query === 'string' ? raw.query : '',
    facets,
    playlists,
    sort: { key: sortKey, dir },
    // Absent in payloads written before soft delete existed, which is why the
    // version was not bumped for it: the field simply falls back to the
    // default rather than throwing a whole saved filter bar away.
    removedView: isRemovedView(raw.removedView) ? raw.removedView : EMPTY.removedView,
  };
}

export function loadFilters(knownPlaylists: ReadonlySet<string>): FilterState {
  try {
    const raw = localStorage.getItem(KEY);
    return reconcileFilters(raw ? JSON.parse(raw) : null, knownPlaylists);
  } catch {
    return EMPTY;
  }
}

export function saveFilters(state: FilterState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, ...state }));
  } catch { /* a lost filter is not worth surfacing */ }
}
