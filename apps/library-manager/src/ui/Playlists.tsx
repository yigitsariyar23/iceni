// The playlist list, grouped by the folder each one sits in.
//
// Deleting is offered here and nowhere else, and it is the only destructive
// action in the app Spotify can undo: a deleted playlist stays recoverable
// from the account page for 90 days. That is why this list will delete a
// playlist while the Cleanup tab still only points empty ones out -- removing
// a track from a playlist has no way back, so it stays a per-row decision.
//
// Moving a playlist between folders is deliberately not offered. RootlistAPI
// can do it, but the position descriptor its move takes was not something the
// client's own code made legible enough to reproduce safely, and getting it
// wrong would scatter playlists rather than fail.

import type { ScanResult } from '../api/scan';
import { navigateTo, removePlaylists } from '../api/platform';
import { ContextMenu, type MenuItem, type MenuState } from './ContextMenu';
import { Confirm, Empty, SearchInput, fmtInt } from './components';
import { MarqueeBox, useMarquee } from './Marquee';

const { useCallback, useMemo, useRef, useState } = Spicetify.React;

const LOOSE = 'Not in a folder';

export function Playlists({
  scan,
  onChanged,
  busy,
  setBusy,
}: {
  scan: ScanResult;
  onChanged: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pending, setPending] = useState<null | { title: string; body: React.ReactNode; label: string; run: () => void }>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byFolder = new Map<string, ScanResult['playlists']>();
    for (const p of scan.playlists) {
      if (q && !p.name.toLowerCase().includes(q)) continue;
      const key = p.folders.length ? p.folders.join(' / ') : LOOSE;
      const list = byFolder.get(key) ?? [];
      list.push(p);
      byFolder.set(key, list);
    }
    return [...byFolder.entries()]
      .map(([folder, items]) => ({
        folder,
        items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      // Foldered groups first, alphabetically; the loose ones last.
      .sort((a, b) => {
        if (a.folder === LOOSE) return 1;
        if (b.folder === LOOSE) return -1;
        return a.folder.localeCompare(b.folder);
      });
  }, [scan, query]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const selectedPlaylists = useMemo(
    () => flat.filter((p) => selected.has(p.uri)),
    [flat, selected],
  );

  const marqueeBase = useRef<Set<string>>(new Set());
  const onMarquee = useCallback((hits: string[], additive: boolean) => {
    setSelected((prev) => {
      if (!marqueeBase.current.size && additive) marqueeBase.current = new Set(prev);
      const next = new Set(additive ? marqueeBase.current : []);
      for (const uri of hits) next.add(uri);
      return next;
    });
  }, []);
  const { band, onMouseDown } = useMarquee({
    containerRef: listRef,
    rowSelector: '.lm-pl__row',
    onSelect: onMarquee,
  });

  const clickRow = (uri: string, e: React.MouseEvent) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.metaKey || e.ctrlKey || e.shiftKey) {
        if (next.has(uri)) next.delete(uri);
        else next.add(uri);
        return next;
      }
      if (next.size === 1 && next.has(uri)) return new Set();
      return new Set([uri]);
    });
  };

  const run = async (fn: () => Promise<void>) => {
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
  };

  const confirmDelete = (targets: typeof flat) => {
    const n = targets.length;
    const what = n === 1 ? `"${targets[0]!.name}"` : `${fmtInt(n)} playlists`;
    const tracks = targets.reduce((a, p) => a + p.tracks.length, 0);
    setPending({
      title: n === 1 ? 'Delete playlist' : 'Delete playlists',
      label: `Delete ${fmtInt(n)}`,
      body: (
        <>
          <p>{what} will be removed from your library{tracks ? `, holding ${fmtInt(tracks)} tracks between them` : ''}.</p>
          <p>
            Unlike everything else here this one can be undone: Spotify keeps a
            deleted playlist recoverable from your account page for 90 days.
          </p>
        </>
      ),
      run: () => void run(async () => {
        await removePlaylists(targets.map((p) => p.uri));
        Spicetify.showNotification(`Deleted ${n} playlist${n === 1 ? '' : 's'}`);
      }),
    });
  };

  const buildMenu = (uri: string): MenuItem[] => {
    const targets = selected.has(uri) && selectedPlaylists.length
      ? selectedPlaylists
      : flat.filter((p) => p.uri === uri);
    return [
      { label: 'Go to playlist', action: () => navigateTo(uri) },
      { separator: true },
      {
        label: targets.length === 1 ? 'Delete playlist' : `Delete ${fmtInt(targets.length)} playlists`,
        danger: true,
        action: () => confirmDelete(targets),
      },
    ];
  };

  return (
    <div className="lm-playlists">
      <div className="lm-filters">
        <div className="lm-field">
          <SearchInput value={query} onChange={setQuery} placeholder="Search playlists" />
          {query ? (
            <button type="button" className="lm-clear" aria-label="Clear search"
              onClick={() => setQuery('')}>×</button>
          ) : null}
        </div>
        {selected.size ? (
          <button type="button" className="lm-btn lm-btn--pill lm-btn--danger" disabled={busy}
            onClick={() => confirmDelete(selectedPlaylists)}>
            Delete {fmtInt(selected.size)}
          </button>
        ) : null}
        <span className="lm-count">
          {fmtInt(flat.length)} of {fmtInt(scan.playlists.length)} playlists
          {selected.size ? ` · ${fmtInt(selected.size)} selected` : ''}
        </span>
      </div>

      {flat.length ? (
        <div className="lm-pl" ref={listRef} onMouseDown={onMouseDown}>
          {groups.map((g) => (
            <div className="lm-pl__group" key={g.folder}>
              <h3 className="lm-pl__folder">
                {g.folder}
                <span className="lm-pill">{fmtInt(g.items.length)}</span>
              </h3>
              {g.items.map((p) => (
                <div
                  key={p.uri}
                  data-uri={p.uri}
                  className={`lm-pl__row ${selected.has(p.uri) ? 'lm-pl__row--on' : ''}`}
                  onClick={(e) => clickRow(p.uri, e)}
                  onDoubleClick={() => navigateTo(p.uri)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (!selected.has(p.uri)) setSelected(new Set([p.uri]));
                    setMenu({ x: e.clientX, y: e.clientY, items: buildMenu(p.uri) });
                  }}
                >
                  <span className="lm-pl__name" title={p.name}>{p.name}</span>
                  {!p.isOwnedBySelf ? (
                    <span className="lm-pl__tag" title={`Owned by ${p.owner ?? 'someone else'}`}>
                      {p.owner ?? 'shared'}
                    </span>
                  ) : null}
                  <span className="lm-pl__count">{fmtInt(p.tracks.length)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <Empty>No playlist matches that search.</Empty>
      )}

      <MarqueeBox band={band} />
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
      <Confirm
        open={!!pending}
        title={pending?.title ?? ''}
        body={pending?.body}
        confirmLabel={pending?.label ?? ''}
        busy={busy}
        onConfirm={() => pending?.run()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
