import { buildIndex, computeStats, scanLibrary, type ScanProgress, type ScanResult } from '../api/scan';
import { describeAge, loadScan, saveScan } from '../api/cache';
import {
  fetchPlaycounts, isStale, loadPlaycounts, savePlaycounts,
  type PlaycountProgress,
} from '../api/playcounts';
import { collapseChrome, makeNavToggle, restoreChrome } from '../api/shell';
import { goBack } from '../api/platform';
import { downloadScan } from '../api/export';
import { Browse } from './Browse';
import { Cleanup } from './Cleanup';
import { Overview } from './Overview';
import { Playlists } from './Playlists';
import { fmtInt } from './components';

const { useCallback, useEffect, useMemo, useRef, useState } = Spicetify.React;

type Tab = 'overview' | 'playlists' | 'cleanup' | 'browse';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'browse', label: 'Browse' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'cleanup', label: 'Cleanup' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('overview');
  // Seeded from the cache during the first render, so a return visit paints
  // the dashboard rather than a progress bar. A scan only happens when there
  // is nothing cached, or when asked for.
  const [scan, setScan] = useState<ScanResult | null>(() => loadScan());
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plays, setPlays] = useState<Record<string, number>>(() => loadPlaycounts()?.counts ?? {});
  const [playsProgress, setPlaysProgress] = useState<PlaycountProgress | null>(null);
  const [playsError, setPlaysError] = useState<string | null>(null);
  const scanning = useRef(false);
  const fetchingPlays = useRef(false);

  const rescan = useCallback(async () => {
    if (scanning.current) return;
    scanning.current = true;
    setError(null);
    setProgress({ phase: 'liked', done: 0, total: 0, label: 'Starting' });
    try {
      const result = await scanLibrary(setProgress);
      setScan(result);
      saveScan(result);
    } catch (e) {
      console.error('[library-manager] scan failed', e);
      setError((e as Error)?.message ?? 'Could not read the library.');
    } finally {
      scanning.current = false;
      setProgress(null);
    }
  }, []);

  // First visit only: with nothing cached there is nothing to show, so the
  // scan starts on its own. Afterwards it is always a deliberate act.
  useEffect(() => {
    if (scan) return undefined;
    let cancelled = false;
    const start = async () => {
      // Platform is attached asynchronously after the client boots, and the
      // collections stay empty for a moment after that.
      for (let i = 0; i < 40; i++) {
        if (Spicetify.Platform?.RootlistAPI && Spicetify.Platform?.LibraryAPI) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!cancelled) void rescan();
    };
    void start();
    return () => { cancelled = true; };
    // Deliberately not re-run when `scan` arrives: this is a first-mount check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The dashboard is a wide table; the library sidebar and the now-playing
  // panel are given back their space when the route is left -- which includes
  // following a link out of it, since that unmounts this component.
  useEffect(() => {
    const saved = collapseChrome();
    // The nav entry is rendered by spicetify a moment after the route mounts on
    // a cold start, so the toggle is attached on a short retry rather than once.
    let detach = makeNavToggle(goBack);
    let tries = 0;
    const timer = setInterval(() => {
      if (detach || tries++ > 20) return clearInterval(timer);
      detach = makeNavToggle(goBack);
    }, 150);
    return () => {
      clearInterval(timer);
      detach?.();
      restoreChrome(saved);
    };
  }, []);

  const index = useMemo(() => (scan ? buildIndex(scan) : new Map()), [scan]);
  const stats = useMemo(() => (scan ? computeStats(scan, index) : null), [scan, index]);

  // Global play counts. One getAlbum query per distinct album is several
  // hundred requests, so this runs in the background behind the scan rather
  // than blocking it, and only when the cached figures have aged out.
  const refreshPlays = useCallback(async (albums: string[]) => {
    if (fetchingPlays.current || !albums.length) return;
    fetchingPlays.current = true;
    setPlaysError(null);
    setPlaysProgress({ done: 0, total: albums.length, failed: 0 });
    const before = loadPlaycounts()?.counts ?? {};
    try {
      const { counts, failed, total } = await fetchPlaycounts(albums, setPlaysProgress);
      // Merged over what was there: an album that failed this time keeps
      // whatever figure it had rather than blanking the column.
      const merged = { ...before, ...counts };
      setPlays(merged);
      savePlaycounts({ at: Date.now(), counts: merged });
      if (failed) {
        console.warn(`[library-manager] ${failed}/${total} albums had no play count`);
      }
    } catch (e) {
      // Surfaced rather than swallowed: the first version failed every album
      // in turn, cached an empty map, and looked exactly like a library with
      // no play counts.
      console.error('[library-manager] play counts failed', e);
      setPlaysError((e as Error)?.message ?? 'Could not read play counts.');
    } finally {
      fetchingPlays.current = false;
      setPlaysProgress(null);
    }
  }, []);

  const albumUris = useMemo(
    () => [...new Set(
      [...index.values()].map((t) => t.albumUri).filter((uri): uri is string => !!uri),
    )],
    [index],
  );

  useEffect(() => {
    if (!scan || !albumUris.length) return;
    if (!isStale(loadPlaycounts())) return;
    void refreshPlays(albumUris);
    // No cleanup that cancels: this is a background enrichment, and tearing it
    // down on a re-render used to leave the work done but the result thrown
    // away, with the in-flight guard blocking any retry.
  }, [scan, albumUris, refreshPlays]);

  return (
    <div className="lm-root">
      <header className="lm-head">
        <div className="lm-head__title">
          <h1>Library Manager</h1>
          <p className="lm-dim">
            {scan && stats ? (
              <>
                {fmtInt(stats.playlistCount)} playlists · {fmtInt(stats.likedCount)} liked ·{' '}
                {fmtInt(stats.uniqueTracks)} distinct tracks
                <span className="lm-dot">·</span>
                <span title={new Date(scan.scannedAt).toLocaleString()}>
                  scanned {describeAge(scan.scannedAt)}
                </span>
              </>
            ) : (
              'Reading the library'
            )}
          </p>
        </div>
        <div className="lm-head__actions">
          {scan ? (
            <button
              type="button"
              className="lm-btn"
              disabled={busy || !!progress}
              title="Write the whole scan to a JSON file. Nothing this app removes can be recovered from Spotify, so this is the only record of what was where."
              onClick={() => {
                try {
                  downloadScan(scan);
                } catch (e) {
                  console.error('[library-manager] export failed', e);
                  Spicetify.showNotification('Library Manager: export failed', true);
                }
              }}
            >
              Export snapshot
            </button>
          ) : null}
          {scan ? (
            <button
              type="button"
              className="lm-btn"
              disabled={busy || !!progress || !!playsProgress}
              title="Global play counts come one album at a time, so this takes a few minutes. It refreshes itself weekly."
              onClick={() => void refreshPlays(albumUris)}
            >
              {playsProgress ? 'Fetching…' : 'Play counts'}
            </button>
          ) : null}
          <button type="button" className="lm-btn" disabled={!!progress || busy} onClick={() => void rescan()}>
            {progress ? 'Scanning…' : 'Rescan'}
          </button>
        </div>
      </header>

      {progress ? <ScanBar progress={progress} /> : null}
      {!progress && playsProgress ? (
        <p className="lm-foot">
          Fetching global play counts — {playsProgress.done}/{playsProgress.total} albums
          {playsProgress.failed ? ` · ${playsProgress.failed} unavailable` : ''}
        </p>
      ) : null}
      {playsError ? (
        <p className="lm-foot lm-foot--warn">
          {playsError}{' '}
          <button type="button" className="lm-link" onClick={() => void refreshPlays(albumUris)}>
            Try again
          </button>
        </p>
      ) : null}

      {error ? (
        <div className="lm-error">
          <p>{error}</p>
          <button type="button" className="lm-btn" onClick={() => void rescan()}>Try again</button>
        </div>
      ) : null}

      {scan && stats ? (
        <>
          <nav className="lm-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`lm-tab ${tab === t.id ? 'lm-tab--on' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className={busy ? 'lm-body lm-body--busy' : 'lm-body'}>
            {tab === 'overview' ? <Overview scan={scan} stats={stats} /> : null}
            {tab === 'playlists' ? (
              <Playlists scan={scan} onChanged={() => void rescan()} busy={busy} setBusy={setBusy} />
            ) : null}
            {tab === 'cleanup' ? (
              <Cleanup scan={scan} index={index} onChanged={() => void rescan()} busy={busy} setBusy={setBusy} />
            ) : null}
            {tab === 'browse' ? (
              <Browse scan={scan} index={index} plays={plays} onChanged={() => void rescan()}
                busy={busy} setBusy={setBusy} />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ScanBar({ progress }: { progress: ScanProgress }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="lm-scan">
      <div className="lm-scan__track">
        <div
          className={progress.total ? 'lm-scan__fill' : 'lm-scan__fill lm-scan__fill--idle'}
          style={progress.total ? { width: `${pct}%` } : undefined}
        />
      </div>
      <p className="lm-dim">
        {progress.total
          ? `Reading playlists ${progress.done}/${progress.total} — ${progress.label}`
          : progress.label}
      </p>
    </div>
  );
}
