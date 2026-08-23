import { buildIndex, computeStats, scanLibrary, type ScanProgress, type ScanResult } from '../api/scan';
import { downloadScan } from '../api/export';
import { Browse } from './Browse';
import { Cleanup } from './Cleanup';
import { Overview } from './Overview';
import { fmtInt } from './components';

const { useCallback, useEffect, useMemo, useState } = Spicetify.React;

type Tab = 'overview' | 'cleanup' | 'browse';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'cleanup', label: 'Cleanup' },
  { id: 'browse', label: 'Browse' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setProgress({ phase: 'liked', done: 0, total: 0, label: 'Starting' });
    try {
      const result = await scanLibrary(setProgress);
      setScan(result);
    } catch (e) {
      console.error('[library-manager] scan failed', e);
      setError((e as Error)?.message ?? 'Could not read the library.');
    } finally {
      setProgress(null);
    }
  }, []);

  useEffect(() => {
    // The Platform APIs are attached asynchronously after the client boots, and
    // the collections are empty for a few seconds after that. Waiting for the
    // rootlist to exist is the cheapest signal that both are ready.
    let cancelled = false;
    const start = async () => {
      for (let i = 0; i < 40; i++) {
        if (Spicetify.Platform?.RootlistAPI && Spicetify.Platform?.LibraryAPI) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!cancelled) void load();
    };
    void start();
    return () => { cancelled = true; };
  }, [load]);

  const index = useMemo(() => (scan ? buildIndex(scan) : new Map()), [scan]);
  const stats = useMemo(() => (scan ? computeStats(scan, index) : null), [scan, index]);

  return (
    <div className="lm-root">
      <header className="lm-head">
        <div>
          <h1>Library Manager</h1>
          <p className="lm-dim">
            {scan
              ? `${fmtInt(stats!.playlistCount)} playlists · ${fmtInt(stats!.likedCount)} liked · ${fmtInt(stats!.uniqueTracks)} distinct tracks`
              : 'Reading the library'}
          </p>
        </div>
        <div className="lm-head__actions">
          {scan ? (
            <button
              type="button"
              className="lm-btn"
              disabled={busy}
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
          <button type="button" className="lm-btn" disabled={!!progress || busy} onClick={() => void load()}>
            {progress ? 'Scanning…' : 'Rescan'}
          </button>
        </div>
      </header>

      {progress ? <ScanBar progress={progress} /> : null}

      {error ? (
        <div className="lm-error">
          <p>{error}</p>
          <button type="button" className="lm-btn" onClick={() => void load()}>Try again</button>
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
            {tab === 'cleanup' ? (
              <Cleanup scan={scan} index={index} onChanged={() => void load()} busy={busy} setBusy={setBusy} />
            ) : null}
            {tab === 'browse' ? (
              <Browse scan={scan} index={index} onChanged={() => void load()} busy={busy} setBusy={setBusy} />
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
