// Snapshot export.
//
// Nothing this app removes can be recovered: Spotify's only restore path is
// the account page's 90-day playlist recovery, which brings back a whole
// deleted playlist and has no notion of a row removed from one, or of a track
// unliked. The scan already holds the entire library in memory, so writing it
// out before a bulk edit costs nothing and leaves a record of what was where.
//
// The file never leaves the machine -- it is a Blob handed to the client's own
// download path.

import type { ScanResult } from './scan';

/** Format marker, so a future reader can tell what it is holding. */
const FORMAT = 'iceni-library-manager/1';

interface ExportedTrack {
  uri: string;
  name: string;
  artists: string[];
  album: string;
  addedAt: string | null;
  durationMs: number;
  isPlayable: boolean;
  isLocal: boolean;
  /** Present only on playlist rows: the handle a restore would need. */
  uid?: string;
}

const slim = (t: LibraryTrack, uid?: string): ExportedTrack => ({
  uri: t.uri,
  name: t.name,
  artists: (t.artists ?? []).map((a) => a.name),
  album: t.album?.name ?? '',
  addedAt: t.addedAt ?? null,
  durationMs: t.duration?.milliseconds ?? 0,
  isPlayable: t.isPlayable !== false,
  isLocal: !!t.isLocal,
  ...(uid ? { uid } : {}),
});

export function buildExport(scan: ScanResult) {
  return {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    scannedAt: new Date(scan.scannedAt).toISOString(),
    counts: {
      playlists: scan.playlists.length,
      likedSongs: scan.liked.length,
      playlistRows: scan.playlists.reduce((a, p) => a + p.tracks.length, 0),
    },
    likedSongs: scan.liked.map((t) => slim(t)),
    playlists: scan.playlists.map((p) => ({
      uri: p.uri,
      name: p.name,
      folders: p.folders,
      isOwnedBySelf: p.isOwnedBySelf,
      trackCount: p.tracks.length,
      tracks: p.tracks.map((t) => slim(t, t.uid)),
    })),
  };
}

export function exportFileName(scan: ScanResult): string {
  // Local date, not ISO: this lands in the user's Downloads folder, where a
  // UTC stamp on an evening export reads as the wrong day.
  const d = new Date(scan.scannedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `iceni-library-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

export function downloadScan(scan: ScanResult): void {
  const blob = new Blob([JSON.stringify(buildExport(scan), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName(scan);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick rather than immediately: revoking synchronously
  // after click() races the download in Chromium and yields an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
