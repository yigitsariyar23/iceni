import type { ScanResult, Stats } from '../api/scan';
import { navigateTo } from '../api/platform';
import { Bar, Section, Stat, fmtDuration, fmtInt } from './components';

export function Overview({ scan, stats }: { scan: ScanResult; stats: Stats }) {
  const maxArtist = stats.topArtists[0]?.count ?? 0;
  const maxPlaylist = stats.largestPlaylists[0]?.count ?? 0;
  const maxYear = Math.max(1, ...stats.byYear.map((y) => y.count));
  // Rows minus distinct tracks: how much of the library is the same song
  // filed in more than one place.
  const overlap = stats.totalRows - stats.uniqueTracks;

  return (
    <div className="lm-overview">
      <div className="lm-stats">
        <Stat label="Playlists" value={fmtInt(stats.playlistCount)}
          hint={`${fmtInt(stats.ownedPlaylists)} yours · ${fmtInt(stats.folderCount)} folders`} />
        <Stat label="Liked Songs" value={fmtInt(stats.likedCount)} />
        <Stat label="Distinct tracks" value={fmtInt(stats.uniqueTracks)}
          hint={`${fmtInt(stats.totalRows)} rows · ${fmtInt(overlap)} repeats`} />
        <Stat label="Artists" value={fmtInt(stats.uniqueArtists)} />
        <Stat label="Listening time" value={fmtDuration(stats.totalDurationMs)}
          hint="distinct tracks, played once each" />
        <Stat label="Unplayable" value={fmtInt(stats.unplayable)}
          hint={stats.localFiles ? `${fmtInt(stats.localFiles)} local files` : undefined} />
      </div>

      <div className="lm-cols">
        <Section title="Most collected artists" description="Distinct tracks in the library.">
          {stats.topArtists.length ? (
            <ul className="lm-rank">
              {stats.topArtists.map((a) => (
                <li key={a.name}>
                  <span className="lm-rank__name" title={a.name}>{a.name}</span>
                  <Bar value={a.count} max={maxArtist} />
                  <span className="lm-rank__count">{fmtInt(a.count)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>

        <Section title="Largest playlists">
          <ul className="lm-rank">
            {stats.largestPlaylists.map((p) => (
              <li key={p.uri}>
                <button type="button" className="lm-rank__name lm-link" title={p.name}
                  onClick={() => navigateTo(p.uri)}>
                  {p.name}
                </button>
                <Bar value={p.count} max={maxPlaylist} />
                <span className="lm-rank__count">{fmtInt(p.count)}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Added by year"
        description="When each distinct track first entered the library, whether liked or added to a playlist.">
        <div className="lm-years">
          {stats.byYear.map((y) => (
            <div className="lm-year" key={y.year} title={`${y.year}: ${fmtInt(y.count)}`}>
              <div className="lm-year__bar" style={{ height: `${(y.count / maxYear) * 100}%` }} />
              <div className="lm-year__label">{String(y.year).slice(2)}</div>
            </div>
          ))}
        </div>
      </Section>

      <p className="lm-foot">
        Scanned {new Date(scan.scannedAt).toLocaleString()}.
      </p>
    </div>
  );
}
