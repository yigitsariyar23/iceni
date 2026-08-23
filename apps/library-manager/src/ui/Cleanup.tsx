import type { DuplicateGroup, ScanResult, TrackRef } from '../api/scan';
import { findDuplicates } from '../api/scan';
import { navigateTo, removeFromPlaylist, unlikeTracks } from '../api/platform';
import { Confirm, Empty, Section, fmtDate, fmtInt } from './components';

const { useMemo, useState } = Spicetify.React;

type Pending = { title: string; body: React.ReactNode; label: string; run: () => Promise<void> } | null;

export function Cleanup({
  scan,
  index,
  onChanged,
  busy,
  setBusy,
}: {
  scan: ScanResult;
  index: Map<string, TrackRef>;
  onChanged: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const [pending, setPending] = useState<Pending>(null);

  const duplicates = useMemo(() => findDuplicates(scan), [scan]);
  const playlistNames = useMemo(
    () => new Map(scan.playlists.map((p) => [p.uri, p.name])),
    [scan],
  );

  const refs = useMemo(() => [...index.values()], [index]);
  // A liked song that is in no playlist at all. Not a fault -- some people
  // keep everything loose -- but it is the list you want when tidying up.
  const orphans = useMemo(
    () => refs.filter((r) => r.liked && r.playlists.length === 0)
      .sort((a, b) => b.addedAt - a.addedAt),
    [refs],
  );
  const unplayable = useMemo(
    () => refs.filter((r) => !r.isPlayable && !r.isLocal),
    [refs],
  );
  const emptyPlaylists = useMemo(
    () => scan.playlists.filter((p) => p.tracks.length === 0),
    [scan],
  );

  const extraCopies = duplicates.reduce((a, g) => a + g.rows.length - 1, 0);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      console.error('[library-manager]', e);
      Spicetify.showNotification(`Library Manager: ${(e as Error)?.message ?? 'action failed'}`, true);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const confirmDedupe = () =>
    setPending({
      title: 'Remove duplicate rows',
      label: `Remove ${fmtInt(extraCopies)} rows`,
      body: (
        <>
          <p>
            {fmtInt(extraCopies)} extra {extraCopies === 1 ? 'row' : 'rows'} across{' '}
            {fmtInt(duplicates.length)} {duplicates.length === 1 ? 'track' : 'tracks'} will be
            removed from their playlists.
          </p>
          <p>The earliest-added copy of each track is kept. This cannot be undone from Spotify.</p>
        </>
      ),
      run: () =>
        run(async () => {
          // Grouped per playlist so each playlist takes a single write.
          const byPlaylist = new Map<string, Array<{ uri: string; uid: string }>>();
          for (const g of duplicates) {
            const list = byPlaylist.get(g.playlistUri) ?? [];
            for (const row of g.rows.slice(1)) list.push({ uri: row.uri, uid: row.uid });
            byPlaylist.set(g.playlistUri, list);
          }
          for (const [uri, rows] of byPlaylist) {
            if (rows.length) await removeFromPlaylist(uri, rows);
          }
          Spicetify.showNotification(`Removed ${extraCopies} duplicate rows`);
        }),
    });

  const confirmUnlike = (tracks: TrackRef[], what: string) =>
    setPending({
      title: `Remove from Liked Songs`,
      label: `Unlike ${fmtInt(tracks.length)}`,
      body: (
        <p>
          {fmtInt(tracks.length)} {what} will be removed from Liked Songs. They stay in any
          playlist that holds them.
        </p>
      ),
      run: () =>
        run(async () => {
          await unlikeTracks(tracks.map((t) => t.uri));
          Spicetify.showNotification(`Removed ${tracks.length} from Liked Songs`);
        }),
    });

  return (
    <div className="lm-cleanup">
      <Section
        title="Duplicate rows"
        count={extraCopies}
        description="The same track filed more than once inside a single playlist."
      >
        {duplicates.length ? (
          <>
            <div className="lm-actions">
              <button type="button" className="lm-btn lm-btn--danger" disabled={busy}
                onClick={confirmDedupe}>
                Remove {fmtInt(extraCopies)} extra {extraCopies === 1 ? 'row' : 'rows'}
              </button>
            </div>
            <DupTable groups={duplicates.slice(0, 200)} names={playlistNames} />
            {duplicates.length > 200 ? (
              <p className="lm-foot">Showing the first 200 of {fmtInt(duplicates.length)}.</p>
            ) : null}
          </>
        ) : (
          <Empty>No playlist holds the same track twice.</Empty>
        )}
      </Section>

      <Section
        title="Liked but unfiled"
        count={orphans.length}
        description="Liked Songs that are in none of your playlists."
      >
        {orphans.length ? (
          <>
            <div className="lm-actions">
              <button type="button" className="lm-btn" disabled={busy}
                onClick={() => confirmUnlike(orphans, 'liked songs')}>
                Unlike all {fmtInt(orphans.length)}
              </button>
            </div>
            <TrackTable rows={orphans.slice(0, 300)} />
            {orphans.length > 300 ? (
              <p className="lm-foot">Showing the 300 most recent of {fmtInt(orphans.length)}.</p>
            ) : null}
          </>
        ) : (
          <Empty>Every liked song is in at least one playlist.</Empty>
        )}
      </Section>

      <Section
        title="Unplayable"
        count={unplayable.length}
        description="Tracks Spotify can no longer play here -- pulled from the catalogue, or unavailable in this market."
      >
        {unplayable.length ? (
          <>
            {unplayable.some((t) => t.liked) ? (
              <div className="lm-actions">
                <button type="button" className="lm-btn" disabled={busy}
                  onClick={() => confirmUnlike(unplayable.filter((t) => t.liked), 'unplayable tracks')}>
                  Unlike the {fmtInt(unplayable.filter((t) => t.liked).length)} that are liked
                </button>
              </div>
            ) : null}
            <TrackTable rows={unplayable.slice(0, 300)} />
          </>
        ) : (
          <Empty>Everything in the library still plays.</Empty>
        )}
      </Section>

      <Section
        title="Empty playlists"
        count={emptyPlaylists.length}
        description="Deleting a playlist is left to Spotify's own menu -- this only points them out."
      >
        {emptyPlaylists.length ? (
          <ul className="lm-list">
            {emptyPlaylists.map((p) => (
              <li key={p.uri}>
                <button type="button" className="lm-link" onClick={() => navigateTo(p.uri)}>
                  {p.name}
                </button>
                {p.folders.length ? <span className="lm-dim"> in {p.folders.join(' / ')}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No empty playlists.</Empty>
        )}
      </Section>

      {scan.emptyFolders.length ? (
        <Section title="Empty folders" count={scan.emptyFolders.length}>
          <ul className="lm-list">
            {scan.emptyFolders.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </Section>
      ) : null}

      <Confirm
        open={!!pending}
        title={pending?.title ?? ''}
        body={pending?.body}
        confirmLabel={pending?.label ?? ''}
        onConfirm={() => void pending?.run()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function DupTable({
  groups,
  names,
}: {
  groups: DuplicateGroup[];
  names: Map<string, string>;
}) {
  return (
    <table className="lm-table">
      <thead>
        <tr>
          <th>Track</th>
          <th>Artist</th>
          <th>Playlist</th>
          <th className="lm-num">Copies</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <tr key={`${g.playlistUri}:${g.trackUri}:${g.rows[0]!.uid}`}>
            <td>{g.trackName}</td>
            <td className="lm-dim">{g.artistNames}</td>
            <td>
              <button type="button" className="lm-link" onClick={() => navigateTo(g.playlistUri)}>
                {names.get(g.playlistUri) ?? g.playlistName}
              </button>
            </td>
            <td className="lm-num">{g.rows.length}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TrackTable({ rows }: { rows: TrackRef[] }) {
  return (
    <table className="lm-table">
      <thead>
        <tr>
          <th>Track</th>
          <th>Artist</th>
          <th>Album</th>
          <th className="lm-num">Added</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.uri + t.name}>
            <td>{t.name}</td>
            <td className="lm-dim">{t.artistNames}</td>
            <td className="lm-dim">{t.albumName}</td>
            <td className="lm-num lm-dim">{fmtDate(t.addedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
