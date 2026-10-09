import type { ScanResult, TrackRef } from '../api/scan';
import { addToPlaylist, addToQueue, countLiked, likeTracks, likedSongsUri, navigateTo, playNext, playTrack, removeFromPlaylist, unlikeTracks } from '../api/platform';
import { Confirm, Empty, SearchInput, fmtInt } from './components';
import { Cell, GridHeader, nextSort, useColumns, useInfiniteScroll, type Column, type SortDir } from './Grid';
import { ContextMenu, type MenuItem, type MenuState } from './ContextMenu';
import { Select } from './Select';
import { COLUMNS, loadVisible, saveVisible, type ColKey, type ColumnContext } from './columns';
import { clearOrder, loadOrder, moveColumn, saveOrder } from './columnOrder';
import { MarqueeBox, useMarquee } from './Marquee';
import { FACETS, FacetButton, applyFacets, type FacetKey, type FacetState } from './facets';
import { applyPlaylistFilter, nextMode, splitFilters, withMode, type PlaylistFilters } from './playlistFilter';
import { loadFilters, saveFilters } from './filterState';
import {
  RemovedButton, applyRemovedView, isRemoved, loadRemoved, saveRemoved,
  withRemoved, withRestored, type RemovedMap, type RemovedView,
} from './removed';
import { Summary } from './Summary';
import { choosePlayContext } from './playContext';
import { useNowPlaying } from './useNowPlaying';

const { useCallback, useEffect, useMemo, useRef, useState } = Spicetify.React;

const STEP = 120;

/** Above this, a queue action asks first -- see queueAction in the row menu. */
const QUEUE_CONFIRM_OVER = 25;

export function Browse({
  scan,
  index,
  plays,
  onChanged,
  busy,
  setBusy,
}: {
  scan: ScanResult;
  index: Map<string, TrackRef>;
  plays: Record<string, number>;
  onChanged: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const restored = useMemo(
    () => loadFilters(new Set(scan.playlists.map((p) => p.uri))),
    // Deliberately once, on mount: re-reading on every scan would undo edits
    // made since.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [query, setQuery] = useState(restored.query);
  const [facets, setFacets] = useState<Partial<FacetState>>(restored.facets);
  // Any number of playlists, each included or excluded -- the same split the
  // facet buttons use.
  const [playlists_, setPlaylistFilters] = useState<PlaylistFilters>(restored.playlists);
  const [sort, setSort] = useState<{ key: ColKey; dir: SortDir }>(restored.sort);
  // Soft delete. Not part of the scan and not written to Spotify: a set of uris
  // this page keeps out of the way, and the view onto it.
  const [removed, setRemoved] = useState<RemovedMap>(() => loadRemoved());
  const [removedView, setRemovedView] = useState<RemovedView>(restored.removedView);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(STEP);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [visible, setVisible] = useState<ColKey[]>(() => loadVisible());
  const [order, setOrder] = useState<ColKey[]>(() => loadOrder());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<null | { title: string; body: React.ReactNode; label: string; danger?: boolean; run: () => void }>(null);
  const lastClicked = useRef<number>(-1);
  const gridRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // The user's order, not the catalogue's, and hidden columns keep their place
  // in it -- so turning one back on returns it to where it was rather than
  // appending it.
  const shown = useMemo(
    () => order
      .filter((key) => visible.includes(key))
      .map((key) => COLUMNS.find((c) => c.key === key)!)
      .filter(Boolean),
    [order, visible],
  );
  const gridColumns = useMemo<Column<ColKey>[]>(
    () => shown.map((c) => ({
      key: c.key, label: c.label, track: c.track, min: c.min,
      sortable: !!c.sortBy, align: c.align,
    })),
    [shown],
  );

  const { widths, persist, reset, template, flexibleKey } = useColumns('browse', gridColumns);

  // Sorted by folder first, then name, so the group headings the Select draws
  // come out contiguous -- it starts a new heading whenever the group changes.
  const playlists = useMemo(
    () => [...scan.playlists].sort((a, b) => {
      const fa = a.folders.join(' / ');
      const fb = b.folders.join(' / ');
      // Loose playlists sort after the foldered ones rather than under a
      // heading of their own at the top.
      if (fa !== fb) return fa && fb ? fa.localeCompare(fb) : fa ? -1 : 1;
      return a.name.localeCompare(b.name);
    }),
    [scan],
  );
  const groupOf = (folders: string[]) => (folders.length ? folders.join(' / ') : 'Not in a folder');
  const owned = useMemo(() => playlists.filter((p) => p.isOwnedBySelf), [playlists]);
  const names = useMemo(() => new Map(scan.playlists.map((p) => [p.uri, p.name])), [scan]);
  const uidFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of scan.playlists) for (const t of p.tracks) map.set(`${p.uri} ${t.uri}`, t.uid);
    return map;
  }, [scan]);

  const nowPlaying = useNowPlaying();

  const all = useMemo(() => [...index.values()], [index]);
  const ctx = useMemo<ColumnContext>(() => ({ names, plays }), [names, plays]);

  // Applied before everything else, so every count on the page is a count of
  // what the user can actually see -- a filter reading "40 of 900" while 200 of
  // those 900 are hidden would be a lie in both halves.
  const pool = useMemo(
    () => applyRemovedView(all, removed, removedView),
    [all, removed, removedView],
  );
  // Markers for tracks the library no longer holds are kept but not counted:
  // the number on the button has to match the rows the Removed view lists.
  const removedCount = useMemo(
    () => all.filter((t) => isRemoved(removed, t.uri)).length,
    [all, removed],
  );

  const chosen = useMemo(() => splitFilters(playlists_), [playlists_]);
  // Narrowing to a playlist takes it out of what Filed / Unfiled measure, so
  // Unfiled reads as "in the ones you picked and nowhere else" rather than
  // emptying the grid on a contradiction. See the note in facets.tsx.
  const scoped = useMemo(() => new Set(chosen.included), [chosen]);

  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let rows = applyFacets(pool, facets, scoped);
    rows = applyPlaylistFilter(rows, playlists_);
    if (terms.length) {
      rows = rows.filter((r) => {
        const hay = `${r.name} ${r.artistNames} ${r.albumName}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }
    const col = COLUMNS.find((c) => c.key === sort.key);
    if (!sort.dir || !col?.sortBy) return rows;
    const by = col.sortBy;
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const x = by(a, ctx);
      const y = by(b, ctx);
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  }, [pool, query, facets, playlists_, scoped, sort, ctx]);

  useEffect(() => {
    saveFilters({ query, facets, playlists: playlists_, sort, removedView });
  }, [query, facets, playlists_, sort, removedView]);

  const rows = filtered.slice(0, limit);
  const sentinel = useInfiniteScroll(filtered.length, limit, setLimit, STEP);

  const activeFacets = Object.values(facets).filter(Boolean).length;
  const anyFilter = !!query || activeFacets > 0
    || chosen.included.length > 0 || chosen.excluded.length > 0
    || removedView !== 'hide';
  const resetLimit = () => setLimit(STEP);
  const clearFilters = () => {
    setQuery('');
    setFacets({});
    setPlaylistFilters({});
    // Back to the default view as well: someone who cleared every filter and
    // still saw nothing but removed rows would have no idea why.
    setRemovedView('hide');
    resetLimit();
  };
  const setPlaylistMode = (uri: string, wanted: 1 | -1) => {
    setPlaylistFilters((prev) => withMode(prev, uri, nextMode(prev[uri], wanted)));
    resetLimit();
  };

  const setFacet = (key: FacetKey, next: 1 | -1 | undefined) => {
    setFacets((prev) => {
      const copy = { ...prev };
      if (next) copy[key] = next;
      else delete copy[key];
      return copy;
    });
    resetLimit();
  };

  // ── Selection ──────────────────────────────────────────────────────
  const clickRow = (i: number, e: React.MouseEvent) => {
    const row = rows[i];
    if (!row) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && lastClicked.current >= 0) {
        const [from, to] = [lastClicked.current, i].sort((a, b) => a - b);
        for (let k = from; k <= to; k++) {
          const r = rows[k];
          if (r) next.add(r.uri);
        }
        return next;
      }
      if (e.metaKey || e.ctrlKey) {
        if (next.has(row.uri)) next.delete(row.uri);
        else next.add(row.uri);
        return next;
      }
      if (next.size === 1 && next.has(row.uri)) return new Set();
      return new Set([row.uri]);
    });
    lastClicked.current = i;
  };

  // The band reports its hits on every move, so the base it adds to has to be
  // frozen when the drag starts -- otherwise an additive drag would keep
  // folding its own previous result back in and never let a row go.
  const marqueeBase = useRef<Set<string>>(new Set());
  const onMarquee = useCallback((hits: string[], additive: boolean) => {
    setSelected((prev) => {
      if (!marqueeBase.current.size && additive) marqueeBase.current = new Set(prev);
      const base = additive ? marqueeBase.current : new Set<string>();
      const next = new Set(base);
      for (const uri of hits) next.add(uri);
      return next;
    });
  }, []);
  const { band, onMouseDown } = useMarquee({
    containerRef: gridRef,
    rowSelector: '.lm-grid__row',
    startWithin: '.lm-grid__body',
    onSelect: onMarquee,
  });
  useEffect(() => {
    if (!band) marqueeBase.current = new Set();
  }, [band]);

  const selectedRows = useMemo(
    () => (selected.size ? filtered.filter((r) => selected.has(r.uri)) : []),
    [filtered, selected],
  );

  // Escape clears a selection, which is the only way out now that the count
  // bar with its Clear button is gone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !menu && !pending) setSelected(new Set());
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menu, pending]);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [pickerOpen]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      try {
        await fn();
        setSelected(new Set());
        onChanged();
      } catch (e) {
        console.error('[library-manager]', e);
        Spicetify.showNotification(`Library Manager: ${(e as Error)?.message ?? 'action failed'}`, true);
      } finally {
        setBusy(false);
        setPending(null);
      }
    },
    [onChanged, setBusy],
  );

  /**
   * Both of these are local and instant: no confirmation, no busy state, no
   * rescan. Nothing in the library changes, so the rule the rest of this app
   * follows -- state the count and wait for a click -- does not apply. The
   * notification is there because the rows vanish, and a row that vanishes
   * with no word looks like a bug rather than a feature.
   */
  const markRemoved = (uris: string[]) => {
    if (!uris.length) return;
    setRemoved((prev) => {
      const next = withRemoved(prev, uris, Date.now());
      saveRemoved(next);
      return next;
    });
    setSelected(new Set());
    resetLimit();
    Spicetify.showNotification(
      `Removed ${fmtInt(uris.length)} from Browse — the Removed filter has them`,
    );
  };

  const restoreRemoved = (uris: string[]) => {
    if (!uris.length) return;
    setRemoved((prev) => {
      const next = withRestored(prev, uris);
      saveRemoved(next);
      return next;
    });
    setSelected(new Set());
    resetLimit();
    Spicetify.showNotification(`Restored ${fmtInt(uris.length)}`);
  };

  const selectedRemoved = useMemo(
    () => selectedRows.filter((r) => isRemoved(removed, r.uri)),
    [selectedRows, removed],
  );

  const buildMenu = (row: TrackRef): MenuItem[] => {
    const targets = selected.has(row.uri) && selectedRows.length ? selectedRows : [row];
    const n = targets.length;
    const what = n === 1 ? `"${targets[0]!.name}"` : `${fmtInt(n)} tracks`;
    const likedTargets = targets.filter((t) => t.liked);

    // Playable rows only: a track the client cannot play is dropped from the
    // queue without a word, so it is excluded rather than counted.
    const queueable = targets.filter((t) => t.isPlayable);

    /**
     * Queue actions do not touch the library and the queue can be cleared, so
     * they skip the confirmation the library writes get. A large selection
     * still asks -- burying whatever is playing under several hundred tracks
     * is tedious to unpick even if it is not permanent.
     */
    const queueAction = (
      label: string,
      verb: string,
      apply: (uris: string[]) => Promise<void>,
    ): MenuItem => ({
      label: n === 1 ? label : `${label} (${fmtInt(queueable.length)})`,
      disabled: !queueable.length,
      hint: queueable.length ? undefined : 'unplayable',
      action: () => {
        const uris = queueable.map((t) => t.uri);
        const go = () => void run(async () => {
          await apply(uris);
          Spicetify.showNotification(`${verb} ${uris.length}`);
        });
        if (uris.length <= QUEUE_CONFIRM_OVER) return go();
        setPending({
          title: label,
          label: `${label} (${fmtInt(uris.length)})`,
          danger: false,
          body: (
            <p>
              {fmtInt(uris.length)} tracks will be added to the queue. Nothing in
              your library changes, and clearing the queue undoes it.
            </p>
          ),
          run: go,
        });
      },
    });

    const items: MenuItem[] = [
      queueAction('Play next', 'Queued next:', playNext),
      queueAction('Add to queue', 'Queued', addToQueue),
      { separator: true },
      {
        label: n === 1 ? 'Add to playlist' : `Add ${fmtInt(n)} to playlist`,
        submenu: () =>
          owned.length
            ? owned.map((p) => ({
                label: p.name,
                hint: p.folders.length ? p.folders.join(' / ') : fmtInt(p.tracks.length),
                action: () =>
                  setPending({
                    title: 'Add to playlist',
                    label: `Add ${fmtInt(n)}`,
                    danger: false,
                    body: <p>{what} will be appended to <b>{p.name}</b>.</p>,
                    run: () => void run(async () => {
                      await addToPlaylist(p.uri, targets.map((t) => t.uri));
                      Spicetify.showNotification(`Added ${n} to ${p.name}`);
                    }),
                  }),
              }))
            : [{ label: 'No playlists you can edit', disabled: true }],
      },
    ];

    // Exactly one included playlist, so the action names something definite.
    // Under an exclusion the rows are by definition not in it, and under two
    // inclusions "remove from the playlist" would not say which.
    if (chosen.included.length === 1 && !chosen.excluded.length) {
      const playlistUri = chosen.included[0]!;
      const name = names.get(playlistUri) ?? 'this playlist';
      items.push({
        label: `Remove from ${name}`,
        danger: true,
        action: () =>
          setPending({
            title: 'Remove from playlist',
            label: `Remove ${fmtInt(n)}`,
            body: <p>{what} will be removed from <b>{name}</b>. This cannot be undone from Spotify.</p>,
            run: () => void run(async () => {
              const list = targets
                .map((t) => ({ uri: t.uri, uid: uidFor.get(`${playlistUri} ${t.uri}`) }))
                .filter((r): r is { uri: string; uid: string } => !!r.uid);
              if (list.length) await removeFromPlaylist(playlistUri, list);
              Spicetify.showNotification(`Removed ${list.length} from ${name}`);
            }),
          }),
      });
    }

    // Only the direction that would do something is offered. A selection that
    // is entirely liked has nothing to add and gets no Add entry; one with
    // nothing liked gets no Remove entry. A mixed selection gets both, each
    // hinting how many of the rows it would touch.
    // Local files have no catalogue uri, so the library cannot hold them: they
    // are excluded rather than counted and then silently dropped by the call.
    const unlikedTargets = targets.filter((t) => !t.liked && !t.isLocal);
    if (unlikedTargets.length) items.push({
      label: 'Add to Liked Songs',
      hint: unlikedTargets.length !== n ? fmtInt(unlikedTargets.length) : undefined,
      action: () =>
        setPending({
          title: 'Add to Liked Songs',
          label: `Like ${fmtInt(unlikedTargets.length)}`,
          danger: false,
          body: (
            <p>
              {fmtInt(unlikedTargets.length)}{' '}
              {unlikedTargets.length === 1 ? 'track' : 'tracks'} will be added to Liked Songs.
              {unlikedTargets.length !== n
                ? ` The other ${fmtInt(n - unlikedTargets.length)} are already liked.`
                : ''}
            </p>
          ),
          run: () => void run(async () => {
            const uris = unlikedTargets.map((t) => t.uri);
            await likeTracks(uris);
            // Checked rather than assumed. The call resolves whether or not
            // the library actually took the tracks, so reporting success off
            // the back of it alone is how "it did nothing" looks like "done".
            const added = await countLiked(uris);
            if (added === 0) {
              throw new Error('Spotify did not add those tracks to Liked Songs');
            }
            Spicetify.showNotification(
              added === uris.length
                ? `Added ${added} to Liked Songs`
                : `Added ${added} of ${uris.length} to Liked Songs`,
            );
          }),
        }),
    });

    if (likedTargets.length) items.push({
      label: 'Remove from Liked Songs',
      hint: likedTargets.length !== n ? fmtInt(likedTargets.length) : undefined,
      danger: true,
      action: () =>
        setPending({
          title: 'Remove from Liked Songs',
          label: `Unlike ${fmtInt(likedTargets.length)}`,
          body: <p>{fmtInt(likedTargets.length)} of the selected tracks are liked and will be removed from Liked Songs. They stay in any playlist that holds them.</p>,
          run: () => void run(async () => {
            await unlikeTracks(likedTargets.map((t) => t.uri));
            Spicetify.showNotification(`Removed ${likedTargets.length} from Liked Songs`);
          }),
        }),
    });

    // Soft delete, kept apart from the two library removals above by a rule:
    // those cannot be undone from Spotify, this one is a local marker. Same
    // shape as the Liked entries -- a row that is already removed is offered
    // Restore and not Remove, and only a mixed selection sees both.
    const removedTargets = targets.filter((t) => isRemoved(removed, t.uri));
    const presentTargets = targets.filter((t) => !isRemoved(removed, t.uri));
    // Unconditional, unlike the entries: every target is on one side of the
    // line or the other, so at least one of the two below always follows it.
    items.push({ separator: true });
    if (presentTargets.length) items.push({
      label: n === 1 ? 'Remove from Browse' : `Remove ${fmtInt(presentTargets.length)} from Browse`,
      hint: 'hidden here only',
      action: () => markRemoved(presentTargets.map((t) => t.uri)),
    });
    if (removedTargets.length) items.push({
      label: n === 1 ? 'Restore' : `Restore ${fmtInt(removedTargets.length)}`,
      hint: 'shown in Browse again',
      action: () => restoreRemoved(removedTargets.map((t) => t.uri)),
    });

    // No "go to album" or "go to artist" entries: those names are links in the
    // row itself now, which is one click instead of three.
    items.push({ separator: true });
    items.push({ label: 'Play', action: () => playTrack(row.uri) });
    if (row.playlists.length) {
      items.push({
        label: 'Go to playlist',
        hint: fmtInt(row.playlists.length),
        submenu: () => row.playlists.map((uri) => ({
          label: names.get(uri) ?? uri,
          action: () => navigateTo(uri),
        })),
      });
    }
    return items;
  };

  const reorderColumn = (key: ColKey, to: number) => {
    setOrder((prev) => {
      // `to` counts gaps among the *visible* headers; the stored order also
      // holds the hidden ones, so it is translated through the visible list
      // before being applied.
      const target = shown[to]?.key;
      const next = moveColumn(prev, key, target ? prev.indexOf(target) : prev.length);
      saveOrder(next);
      return next;
    });
  };

  const toggleColumn = (key: ColKey) => {
    setVisible((prev) => {
      // At least one column has to remain, or the grid template collapses and
      // the rows render as a blank strip.
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      if (!next.length) return prev;
      saveVisible(next);
      return next;
    });
  };

  return (
    <div className="lm-browse">
      <div className="lm-filters">
        <div className="lm-field">
          <SearchInput value={query} onChange={(v) => { setQuery(v); resetLimit(); }}
            placeholder="Search track, artist or album" />
          {query ? (
            <button type="button" className="lm-clear" aria-label="Clear search"
              onClick={() => { setQuery(''); resetLimit(); }}>×</button>
          ) : null}
        </div>

        <div className="lm-facets">
          {FACETS.map((f) => (
            <FacetButton key={f.key} facet={f} state={facets[f.key]}
              note={f.key === 'filed' && chosen.included.length
                ? 'Counting only playlists outside the ones filtered to'
                : undefined}
              onChange={(next) => setFacet(f.key, next)} />
          ))}
          {/* Sits with the facets and behaves as one: left click for only the
              removed rows, right click to hide them, either again for neutral.
              The only difference is where it starts -- excluding, not neutral,
              because hiding them is the whole point of the feature. */}
          <RemovedButton
            view={removedView}
            count={removedCount}
            onChange={(next) => { setRemovedView(next); resetLimit(); }}
          />
        </div>

        <div className="lm-field">
          <Select
            ariaLabel="Filter by playlist"
            width={200}
            value=""
            placeholder="Playlists…"
            keepOpen
            marks={playlists_}
            options={playlists.map((p) => ({
              value: p.uri,
              label: p.name,
              hint: fmtInt(p.tracks.length),
              group: groupOf(p.folders),
            }))}
            onChange={(v) => setPlaylistMode(v, 1)}
            onNegate={(v) => setPlaylistMode(v, -1)}
          />
        </div>

        {/* One chip per chosen playlist, behaving exactly like a facet: left
            click to include, right click to exclude, the same again clears. */}
        {[...chosen.included, ...chosen.excluded].map((uri) => (
          <button
            key={uri}
            type="button"
            className={`lm-facet ${playlists_[uri] === 1 ? 'lm-facet--in' : 'lm-facet--out'}`}
            title={playlists_[uri] === 1
              ? 'In this playlist — click to clear, right click to invert'
              : 'Not in this playlist — right click to clear, click to invert'}
            onClick={() => setPlaylistMode(uri, 1)}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setPlaylistMode(uri, -1); }}
          >
            {names.get(uri) ?? uri}
          </button>
        ))}

        {anyFilter ? (
          <button type="button" className="lm-btn lm-btn--pill" onClick={clearFilters}>Clear filters</button>
        ) : null}

        {/* Only ever offered for rows that would actually move: under the
            default view a selection is all present, under the Removed view all
            removed, and only "With removed" can show both at once. Removing is
            not offered here at all -- it lives in the row menu, next to the two
            library removals it must not be confused with. */}
        {selectedRemoved.length ? (
          <button
            type="button"
            className="lm-btn lm-btn--pill"
            title="List these rows in Browse again"
            onClick={() => restoreRemoved(selectedRemoved.map((r) => r.uri))}
          >
            Restore {fmtInt(selectedRemoved.length)}
          </button>
        ) : null}
        {/* Restoring hundreds of rows a selection at a time is not a thing
            anyone should have to do, so the Removed view offers the lot. */}
        {removedView === 'only' && !selected.size && removedCount ? (
          <button
            type="button"
            className="lm-btn lm-btn--pill"
            onClick={() => {
              const uris = pool.map((r) => r.uri);
              setPending({
                title: 'Restore everything',
                label: `Restore ${fmtInt(uris.length)}`,
                danger: false,
                body: (
                  <p>
                    {fmtInt(uris.length)} removed{' '}
                    {uris.length === 1 ? 'track' : 'tracks'} will be listed in
                    Browse again.
                  </p>
                ),
                run: () => { restoreRemoved(uris); setPending(null); },
              });
            }}
          >
            Restore all
          </button>
        ) : null}


        {/* Counted rather than left to the difference between two numbers:
            under the default view the total is the library minus the removed
            rows, and that is not something to make anyone work out. Under the
            other two views they are already in it, so the chip goes. */}
        <Summary
          shown={filtered.length}
          total={pool.length}
          filtered={anyFilter}
          hidden={removedView === 'hide' ? removedCount : 0}
          selected={selected.size}
        />

        <div className="lm-picker" ref={pickerRef}>
          <button type="button" className="lm-btn lm-btn--pill"
            aria-expanded={pickerOpen} onClick={() => setPickerOpen((o) => !o)}>
            Columns
          </button>
          {pickerOpen ? (
            <div className="lm-picker__panel lm-picker__panel--right">
              {COLUMNS.map((c) => (
                <label key={c.key} className="lm-picker__row">
                  <input type="checkbox" checked={visible.includes(c.key)}
                    onChange={() => toggleColumn(c.key)} />
                  <span>{c.label}</span>
                </label>
              ))}
              <button
                type="button"
                className="lm-picker__reset"
                onClick={() => {
                  reset();
                  clearOrder();
                  setOrder(loadOrder());
                }}
              >
                Reset layout
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {rows.length ? (
        <div
          className="lm-grid"
          ref={gridRef}
          role="table"
          onMouseDown={onMouseDown}
          style={{ '--lm-cols': template } as React.CSSProperties}
        >
          <GridHeader
            columns={gridColumns}
            sort={sort}
            widths={widths}
            gridRef={gridRef}
            onResize={persist}
            onReorder={reorderColumn}
            flexibleKey={flexibleKey}
            onSort={(key) =>
              setSort((s) => (s.key === key ? { key, dir: nextSort(s.dir) } : { key, dir: 'desc' }))}
          />
          <div className="lm-grid__body">
            {rows.map((t, i) => (
              <div
                key={t.uri + t.name}
                role="row"
                data-uri={t.uri}
                className={[
                  'lm-grid__row',
                  selected.has(t.uri) ? 'lm-grid__row--on' : '',
                  nowPlaying.uri === t.uri ? 'lm-grid__row--playing' : '',
                  // Only under "With removed", where a row's state is not
                  // implied by the view it is in. Dimming every row of the
                  // Removed view would just make that whole page look broken.
                  removedView === 'all' && isRemoved(removed, t.uri) ? 'lm-grid__row--removed' : '',
                ].join(' ')}
                onClick={(e) => clickRow(i, e)}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  // From the playlist the row belongs to, so what plays next is
                  // the rest of that playlist rather than Spotify's guess.
                  const target = choosePlayContext({
                    trackUri: t.uri,
                    playlists: t.playlists,
                    liked: t.liked,
                    filters: playlists_,
                    likedSongsUri: likedSongsUri(),
                  });
                  playTrack(target.trackUri, target.contextUri);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!selected.has(t.uri)) {
                    setSelected(new Set([t.uri]));
                    lastClicked.current = i;
                  }
                  setMenu({ x: e.clientX, y: e.clientY, items: buildMenu(t) });
                }}
              >
                {shown.map((c) => (
                  <Cell
                    key={c.key}
                    align={c.align}
                    title={c.title?.(t, ctx)}
                    // The track name is the row's subject; everything beside it
                    // is supporting detail and reads dimmer.
                    className={c.key === 'name' ? '' : 'lm-dim'}
                  >
                    {c.key === 'name' && nowPlaying.uri === t.uri ? (
                      <span
                        className={nowPlaying.paused ? 'lm-eq lm-eq--paused' : 'lm-eq'}
                        title={nowPlaying.paused ? 'Paused' : 'Now playing'}
                        aria-label={nowPlaying.paused ? 'Paused' : 'Now playing'}
                      >
                        <i /><i /><i />
                      </span>
                    ) : null}
                    {c.render(t, ctx)}
                    {c.key === 'name' ? (
                      <>
                        {t.liked ? <span className="lm-tag" title="In Liked Songs">♥</span> : null}
                        {removedView === 'all' && isRemoved(removed, t.uri) ? (
                          <span className="lm-tag" title="Removed from Browse">⊘</span>
                        ) : null}
                        {!t.isPlayable ? <span className="lm-tag lm-tag--warn" title="Unplayable">!</span> : null}
                      </>
                    ) : null}
                  </Cell>
                ))}
              </div>
            ))}
          </div>
          <div ref={sentinel} className="lm-grid__sentinel" />
        </div>
      ) : (
        <Empty>
          <p>
            {removedView === 'only' && !removedCount
              ? 'Nothing has been removed. Remove hides rows from Browse without touching Spotify.'
              : 'Nothing matches those filters.'}
          </p>
          {anyFilter ? (
            <button type="button" className="lm-btn" onClick={clearFilters}>Clear filters</button>
          ) : null}
        </Empty>
      )}

      {filtered.length > rows.length ? (
        <p className="lm-foot">{fmtInt(filtered.length - rows.length)} more below</p>
      ) : null}

      <MarqueeBox band={band} />
      <ContextMenu state={menu} onClose={() => setMenu(null)} />

      <Confirm
        open={!!pending}
        title={pending?.title ?? ''}
        body={pending?.body}
        confirmLabel={pending?.label ?? ''}
        danger={pending?.danger}
        busy={busy}
        onConfirm={() => pending?.run()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
