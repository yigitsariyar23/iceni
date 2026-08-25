// Soft delete: rows put out of the way in Browse, without touching Spotify.
//
// Everything else in this app that says "remove" writes to the library, and
// Spotify has no undo for any of it. This one writes nothing: it records a
// track uri in localStorage, Browse stops listing it, and Restore drops the
// marker again. Nothing leaves a playlist, nothing is unliked, and a rescan
// does not disturb it.
//
// It exists because auditing a library this size is a long job done in passes.
// Rows that have already been decided about have to get out of the way, and
// until now the only tool for that was an actual deletion.
//
// Free of Spicetify at module scope so the rules can be tested under Node.

import type { TrackRef } from '../api/scan';
import { nextFacet } from './facets';
import { fmtInt } from './format';

const KEY = 'iceni:library-manager:removed';

/** Bump when the payload shape changes; an older one is dropped, not read. */
const VERSION = 1;

/**
 * Track uri -> when it was marked, in ms. Membership is what hides a row; the
 * timestamp is kept so a later view can say when, and costs nothing now.
 */
export type RemovedMap = Record<string, number>;

/**
 * `hide` is the default and the point of the feature: removed rows are not
 * listed at all. `only` is the Removed filter -- nothing but them, which is
 * where restoring happens. `all` puts them back among the rest, marked, for
 * when the question is "what is in here, everything included".
 *
 * These are the three states of a facet under another name -- exclude, include
 * and neutral -- and the button walks between them by the same rules. Stored
 * as words rather than as 1/-1/undefined for one reason: neutral is `absent`
 * in a facet map, and absent has to mean `hide` here, since that is the
 * default and not the do-nothing state.
 */
export type RemovedView = 'hide' | 'only' | 'all';

const VIEWS: RemovedView[] = ['hide', 'only', 'all'];

export const isRemovedView = (v: unknown): v is RemovedView =>
  VIEWS.includes(v as RemovedView);

/** Include keeps removed rows, exclude drops them, neutral does neither. */
const MODE_OF: Record<RemovedView, 1 | -1 | undefined> = {
  only: 1,
  hide: -1,
  all: undefined,
};

const VIEW_OF = (mode: 1 | -1 | undefined): RemovedView =>
  (mode === 1 ? 'only' : mode === -1 ? 'hide' : 'all');

export const isRemoved = (removed: RemovedMap, uri: string): boolean =>
  Object.prototype.hasOwnProperty.call(removed, uri);

/**
 * The facet grammar, borrowed whole: left click walks toward include, right
 * click toward exclude, and either click from the state it already names goes
 * back to neutral. Nothing about removal justifies a second set of rules for
 * the same three states, so nextFacet is what decides.
 */
export function nextRemovedView(current: RemovedView, wanted: 1 | -1): RemovedView {
  return VIEW_OF(nextFacet(MODE_OF[current], wanted));
}

export function applyRemovedView(
  rows: TrackRef[],
  removed: RemovedMap,
  view: RemovedView,
): TrackRef[] {
  if (view === 'all') return rows;
  const wanted = view === 'only';
  return rows.filter((r) => isRemoved(removed, r.uri) === wanted);
}

/** Marks tracks. A uri already marked keeps its original timestamp: the point
 *  of the date is when it was first put aside, not when it was last touched. */
export function withRemoved(removed: RemovedMap, uris: string[], at: number): RemovedMap {
  const next = { ...removed };
  for (const uri of uris) if (!isRemoved(next, uri)) next[uri] = at;
  return next;
}

export function withRestored(removed: RemovedMap, uris: string[]): RemovedMap {
  const next = { ...removed };
  for (const uri of uris) delete next[uri];
  return next;
}

/**
 * Deliberately not pruned against the current scan, unlike the filter bar.
 *
 * A marker for a uri the library no longer holds matches nothing and shows
 * nowhere, so it costs a few bytes and no confusion -- whereas dropping it
 * would silently un-hide the track if it ever came back, which is exactly the
 * case the user was expressing an opinion about.
 */
export function reconcileRemoved(stored: unknown): RemovedMap {
  const raw = stored as { v?: number; tracks?: Record<string, unknown> } | null;
  if (!raw || raw.v !== VERSION || !raw.tracks) return {};
  const out: RemovedMap = {};
  for (const [uri, at] of Object.entries(raw.tracks)) {
    if (uri) out[uri] = typeof at === 'number' && at > 0 ? at : 0;
  }
  return out;
}

export function loadRemoved(): RemovedMap {
  try {
    const raw = localStorage.getItem(KEY);
    return reconcileRemoved(raw ? JSON.parse(raw) : null);
  } catch {
    return {};
  }
}

export function saveRemoved(removed: RemovedMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, tracks: removed }));
  } catch (e) {
    // Worth a word, unlike a lost filter: the user hid those rows on purpose
    // and would find them back after a reload with no explanation.
    console.warn('[library-manager] could not save the removed list', e);
  }
}

/** As on a facet: the exclude state says what it keeps, the others what they
 *  are about. The label names the state the button is in, never the next one. */
const LABELS: Record<RemovedView, string> = {
  hide: 'Not removed',
  only: 'Removed',
  all: 'Removed',
};

const TITLES: Record<RemovedView, string> = {
  hide: 'Removed rows are hidden — click for only them, right click to list everything',
  only: 'Only removed rows — click to list everything, right click to hide them',
  all: 'Everything, removed rows marked — click for only them, right click to hide them',
};

/**
 * Deliberately mirrors FacetButton rather than being one: the state it drives
 * is not a member of FacetState -- it is not a property of a track at all --
 * and it carries a count, which no facet does. The click rules are shared
 * through nextRemovedView, which is the part that would be a bug if the two
 * ever disagreed.
 */
export function RemovedButton({
  view,
  count,
  onChange,
}: {
  view: RemovedView;
  count: number;
  onChange: (next: RemovedView) => void;
}) {
  return (
    <button
      type="button"
      className={[
        'lm-facet',
        view === 'only' ? 'lm-facet--in' : '',
        view === 'hide' ? 'lm-facet--out' : '',
      ].join(' ')}
      aria-pressed={view !== 'all'}
      title={TITLES[view]}
      onClick={() => onChange(nextRemovedView(view, 1))}
      onContextMenu={(e) => {
        e.preventDefault();
        // Stopped as well as prevented, exactly as on a facet: the grid below
        // opens its own menu on right click and this one must not reach it.
        e.stopPropagation();
        onChange(nextRemovedView(view, -1));
      }}
    >
      {LABELS[view]}
      {/* Only where the number is a count of what the button lists. Under the
          default it would sit beside "Not removed" and read as a count of
          those, which is the opposite of what it is; the summary line to the
          right says "12 removed" in full instead. */}
      {count && view !== 'hide' ? ` · ${fmtInt(count)}` : ''}
    </button>
  );
}
