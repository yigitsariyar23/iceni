import type { ScanResult, TrackRef } from '../api/scan';
import { addToPlaylist, navigateTo, playTrack, removeFromPlaylist, unlikeTracks } from '../api/platform';
import { Confirm, Empty, SearchInput, fmtInt } from './components';
import { Cell, GridHeader, nextSort, useColumns, useInfiniteScroll, type Column, type SortDir } from './Grid';
import { ContextMenu, type MenuItem, type MenuState } from './ContextMenu';
import { Select } from './Select';
import { COLUMNS, loadVisible, saveVisible, type ColKey, type ColumnContext } from './columns';
import { MarqueeBox, useMarquee } from './Marquee';
import { FACETS, FacetButton, applyFacets, type FacetKey, type FacetState } from './facets';

const { useCallback, useEffect, useMemo, useRef, useState } = Spicetify.React;

const STEP = 120;

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
  const [query, setQuery] = useState('');
  const [facets, setFacets] = useState<Partial<FacetState>>({});
  const [playlistUri, setPlaylistUri] = useState('');
  const [sort, setSort] = useState<{ key: ColKey; dir: SortDir }>({ key: 'added', dir: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(STEP);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [visible, setVisible] = useState<ColKey[]>(() => loadVisible());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<null | { title: string; body: React.ReactNode; label: string; danger?: boolean; run: () => void }>(null);
  const lastClicked = useRef<number>(-1);
  const gridRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Catalogue order, not click order, so toggling a column back on puts it
  // where it belongs rather than at the end.
  const shown = useMemo(
    () => COLUMNS.filter((c) => visible.includes(c.key)),
    [visible],
  );
  const gridColumns = useMemo<Column<ColKey>[]>(
    () => shown.map((c) => ({
      key: c.key, label: c.label, track: c.track, min: c.min,
      sortable: !!c.sortBy, align: c.align,
    })),
    [shown],
  );

  const { widths, persist, reset, template, resized } = useColumns('browse', gridColumns);

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

  const all = useMemo(() => [...index.values()], [index]);
  const ctx = useMemo<ColumnContext>(() => ({ names, plays }), [names, plays]);

  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let rows = applyFacets(all, facets);
    if (playlistUri) rows = rows.filter((r) => r.playlists.includes(playlistUri));
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
  }, [all, query, facets, playlistUri, sort, ctx]);

  const rows = filtered.slice(0, limit);
  const sentinel = useInfiniteScroll(filtered.length, limit, setLimit, STEP);

  const activeFacets = Object.values(facets).filter(Boolean).length;
  const anyFilter = !!query || activeFacets > 0 || !!playlistUri;
  const resetLimit = () => setLimit(STEP);
  const clearFilters = () => {
    setQuery('');
    setFacets({});
    setPlaylistUri('');
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

  const buildMenu = (row: TrackRef): MenuItem[] => {
    const targets = selected.has(row.uri) && selectedRows.length ? selectedRows : [row];
    const n = targets.length;
    const what = n === 1 ? `"${targets[0]!.name}"` : `${fmtInt(n)} tracks`;
    const likedTargets = targets.filter((t) => t.liked);

    const items: MenuItem[] = [
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

    if (playlistUri) {
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

    items.push({
      label: 'Remove from Liked Songs',
      disabled: !likedTargets.length,
      hint: likedTargets.length && likedTargets.length !== n ? fmtInt(likedTargets.length) : undefined,
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
              onChange={(next) => setFacet(f.key, next)} />
          ))}
        </div>

        <div className="lm-field">
          <Select ariaLabel="Playlist" width={220} value={playlistUri} placeholder="Any playlist"
            options={[
              { value: '', label: 'Any playlist' },
              ...playlists.map((p) => ({
                value: p.uri,
                label: p.name,
                hint: fmtInt(p.tracks.length),
                group: groupOf(p.folders),
              })),
            ]}
            onChange={(v) => { setPlaylistUri(v); resetLimit(); }} />
          {playlistUri ? (
            <button type="button" className="lm-clear" aria-label="Clear playlist"
              onClick={() => { setPlaylistUri(''); resetLimit(); }}>×</button>
          ) : null}
        </div>

        {anyFilter ? (
          <button type="button" className="lm-btn lm-btn--pill" onClick={clearFilters}>Clear filters</button>
        ) : null}


        <span className="lm-count">
          {anyFilter
            ? `${fmtInt(filtered.length)} of ${fmtInt(all.length)} tracks`
            : `${fmtInt(all.length)} tracks`}
          {selected.size ? ` · ${fmtInt(selected.size)} selected` : ''}
        </span>

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
              {resized ? (
                <button type="button" className="lm-picker__reset" onClick={reset}>Reset widths</button>
              ) : null}
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
            onSort={(key) =>
              setSort((s) => (s.key === key ? { key, dir: nextSort(s.dir) } : { key, dir: 'desc' }))}
          />
          <div className="lm-grid__body">
            {rows.map((t, i) => (
              <div
                key={t.uri + t.name}
                role="row"
                data-uri={t.uri}
                className={`lm-grid__row ${selected.has(t.uri) ? 'lm-grid__row--on' : ''}`}
                onClick={(e) => clickRow(i, e)}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  playTrack(t.uri);
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
                    {c.render(t, ctx)}
                    {c.key === 'name' ? (
                      <>
                        {t.liked ? <span className="lm-tag" title="In Liked Songs">♥</span> : null}
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
          <p>Nothing matches those filters.</p>
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
