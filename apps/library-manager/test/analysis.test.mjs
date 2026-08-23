// Tests for the derived views. These decide which rows a bulk action deletes,
// so they are worth pinning down: a duplicate group that keeps the wrong copy,
// or an "unfiled" list that quietly includes filed tracks, is destructive.
//
// Run with: npm test

import assert from 'node:assert/strict';
import { buildIndex, computeStats, findDuplicates } from '../dist-test/scan.mjs';
import { buildExport, exportFileName } from '../dist-test/export.mjs';
import { loadScan, saveScan, clearScan, describeAge } from '../dist-test/cache.mjs';

// saveScan/loadScan talk to localStorage, which Node has no notion of.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let failures = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL ${name}\n     ${e.message}`);
  }
};

const track = (id, over = {}) => ({
  type: 'track',
  uri: `spotify:track:${id}`,
  name: over.name ?? `Track ${id}`,
  duration: { milliseconds: over.durationMs ?? 60_000 },
  album: { type: 'album', uri: `spotify:album:${id}`, name: over.albumName ?? `Album ${id}` },
  artists: (over.artists ?? ['Artist A']).map((n, i) => ({
    type: 'artist', uri: `spotify:artist:${i}:${n}`, name: n,
  })),
  discNumber: 1,
  trackNumber: 1,
  isExplicit: over.isExplicit ?? false,
  isPlayable: over.isPlayable ?? true,
  isLocal: over.isLocal ?? false,
  addedAt: over.addedAt ?? '2024-01-01T00:00:00.000Z',
});

const row = (t, uid) => ({ ...t, uid });

const scanOf = ({ liked = [], playlists = [] }) => ({
  scannedAt: 0,
  liked,
  playlists: playlists.map((p, i) => ({
    uri: p.uri ?? `spotify:playlist:${i}`,
    name: p.name ?? `Playlist ${i}`,
    folders: p.folders ?? [],
    isOwnedBySelf: p.isOwnedBySelf ?? true,
    tracks: p.tracks,
  })),
  folderCount: 0,
  emptyFolders: [],
});

// ── buildIndex ───────────────────────────────────────────────────────────

test('a track liked and in two playlists is one entry listing both', () => {
  const t = track('a');
  const scan = scanOf({
    liked: [t],
    playlists: [
      { uri: 'spotify:playlist:x', tracks: [row(t, 'u1')] },
      { uri: 'spotify:playlist:y', tracks: [row(t, 'u2')] },
    ],
  });
  const index = buildIndex(scan);
  assert.equal(index.size, 1);
  const ref = index.get(t.uri);
  assert.equal(ref.liked, true);
  assert.deepEqual(ref.playlists, ['spotify:playlist:x', 'spotify:playlist:y']);
});

test('the same playlist twice does not list the playlist twice', () => {
  const t = track('a');
  const scan = scanOf({
    playlists: [{ uri: 'spotify:playlist:x', tracks: [row(t, 'u1'), row(t, 'u2')] }],
  });
  assert.deepEqual(buildIndex(scan).get(t.uri).playlists, ['spotify:playlist:x']);
});

test('addedAt keeps the earliest date seen anywhere', () => {
  const early = track('a', { addedAt: '2019-05-05T00:00:00.000Z' });
  const late = track('a', { addedAt: '2023-05-05T00:00:00.000Z' });
  const scan = scanOf({ liked: [late], playlists: [{ tracks: [row(early, 'u1')] }] });
  const ref = buildIndex(scan).get(early.uri);
  assert.equal(new Date(ref.addedAt).getUTCFullYear(), 2019);
});

test('one unplayable copy marks the track unplayable', () => {
  const ok = track('a');
  const bad = track('a', { isPlayable: false });
  const scan = scanOf({ liked: [ok], playlists: [{ tracks: [row(bad, 'u1')] }] });
  assert.equal(buildIndex(scan).get(ok.uri).isPlayable, false);
});

test('local files are keyed by name and artist, not by uri', () => {
  // Local tracks share a useless uri across sources; keying on it would fold
  // unrelated files into one row.
  const a = { ...track('local', { isLocal: true, name: 'Demo', artists: ['X'] }), uri: 'spotify:local::::1' };
  const b = { ...track('local', { isLocal: true, name: 'Other', artists: ['Y'] }), uri: 'spotify:local::::1' };
  const index = buildIndex(scanOf({ liked: [a, b] }));
  assert.equal(index.size, 2);
});

// ── findDuplicates ───────────────────────────────────────────────────────

test('duplicates are found per playlist and the earliest copy is first', () => {
  const t = track('a');
  const scan = scanOf({
    playlists: [{
      uri: 'spotify:playlist:x',
      name: 'Mix',
      tracks: [
        row({ ...t, addedAt: '2024-06-01T00:00:00.000Z' }, 'newer'),
        row({ ...t, addedAt: '2021-01-01T00:00:00.000Z' }, 'oldest'),
        row({ ...t, addedAt: '2022-01-01T00:00:00.000Z' }, 'middle'),
      ],
    }],
  });
  const groups = findDuplicates(scan);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 3);
  // Cleanup keeps rows[0] and removes the rest, so the oldest must sort first.
  assert.equal(groups[0].rows[0].uid, 'oldest');
  assert.deepEqual(groups[0].rows.slice(1).map((r) => r.uid), ['middle', 'newer']);
});

test('the same track in two different playlists is not a duplicate', () => {
  const t = track('a');
  const scan = scanOf({
    playlists: [
      { uri: 'spotify:playlist:x', tracks: [row(t, 'u1')] },
      { uri: 'spotify:playlist:y', tracks: [row(t, 'u2')] },
    ],
  });
  assert.deepEqual(findDuplicates(scan), []);
});

// ── computeStats ─────────────────────────────────────────────────────────

test('stats separate distinct tracks from rows', () => {
  const a = track('a', { artists: ['X'] });
  const b = track('b', { artists: ['X', 'Y'] });
  const scan = scanOf({
    liked: [a],
    playlists: [
      { uri: 'spotify:playlist:x', tracks: [row(a, 'u1'), row(b, 'u2')] },
      { uri: 'spotify:playlist:y', tracks: [row(a, 'u3')] },
    ],
  });
  const stats = computeStats(scan, buildIndex(scan));
  assert.equal(stats.uniqueTracks, 2);
  assert.equal(stats.totalRows, 4); // 3 playlist rows + 1 liked
  assert.equal(stats.likedCount, 1);
  assert.equal(stats.playlistCount, 2);
  assert.equal(stats.uniqueArtists, 2);
  assert.equal(stats.topArtists[0].name, 'X');
  assert.equal(stats.topArtists[0].count, 2);
});

test('duration counts each distinct track once, not once per row', () => {
  const a = track('a', { durationMs: 120_000 });
  const scan = scanOf({
    liked: [a],
    playlists: [{ tracks: [row(a, 'u1')] }, { uri: 'spotify:playlist:z', tracks: [row(a, 'u2')] }],
  });
  const stats = computeStats(scan, buildIndex(scan));
  assert.equal(stats.totalDurationMs, 120_000);
});

test('byYear buckets on the earliest date and is ordered oldest first', () => {
  const scan = scanOf({
    liked: [
      track('a', { addedAt: '2022-03-01T00:00:00.000Z' }),
      track('b', { addedAt: '2020-07-01T00:00:00.000Z' }),
      track('c', { addedAt: '2022-11-01T00:00:00.000Z' }),
    ],
  });
  const stats = computeStats(scan, buildIndex(scan));
  assert.deepEqual(stats.byYear, [{ year: 2020, count: 1 }, { year: 2022, count: 2 }]);
});

// ── export ───────────────────────────────────────────────────────────────

test('the export keeps every row, and playlist rows keep their uid', () => {
  const a = track('a', { artists: ['X', 'Y'] });
  const b = track('b');
  const scan = scanOf({
    liked: [a],
    playlists: [{ uri: 'spotify:playlist:x', name: 'Mix', tracks: [row(a, 'u1'), row(b, 'u2')] }],
  });
  const out = buildExport(scan);
  assert.equal(out.counts.likedSongs, 1);
  assert.equal(out.counts.playlists, 1);
  assert.equal(out.counts.playlistRows, 2);
  assert.equal(out.playlists[0].tracks.length, 2);
  // uid is the only handle a restore could use to address a row.
  assert.deepEqual(out.playlists[0].tracks.map((t) => t.uid), ['u1', 'u2']);
  assert.deepEqual(out.likedSongs[0].artists, ['X', 'Y']);
  // Liked entries are not playlist rows and carry no uid.
  assert.equal('uid' in out.likedSongs[0], false);
});

test('the export is JSON-serialisable with nothing undefined', () => {
  const scan = scanOf({ liked: [track('a')], playlists: [{ tracks: [row(track('b'), 'u1')] }] });
  const json = JSON.stringify(buildExport(scan));
  assert.ok(!json.includes('undefined'));
  assert.deepEqual(JSON.parse(json).counts.playlistRows, 1);
});

test('the export file name uses local date parts, not UTC', () => {
  // A scan at 00:30 local would land on the previous day if this used ISO.
  const d = new Date(2026, 7, 24, 0, 30);
  const name = exportFileName({ ...scanOf({}), scannedAt: d.getTime() });
  assert.equal(name, 'iceni-library-2026-08-24-0030.json');
});

// ── cache ────────────────────────────────────────────────────────────────

test('a scan survives a save/load round trip', () => {
  clearScan();
  const a = track('a', { artists: ['Artist A'], addedAt: '2021-02-03T04:05:06.000Z' });
  const b = track('b', { isPlayable: false, isLocal: true, isExplicit: true });
  const scan = scanOf({
    liked: [a],
    playlists: [{ uri: 'spotify:playlist:x', name: 'Mix', folders: ['Deep'], tracks: [row(a, 'u1'), row(b, 'u2')] }],
  });
  saveScan(scan);
  const back = loadScan();
  assert.ok(back, 'should load something back');
  assert.equal(back.liked.length, 1);
  assert.equal(back.playlists.length, 1);
  assert.deepEqual(back.playlists[0].folders, ['Deep']);
  assert.deepEqual(back.playlists[0].tracks.map((t) => t.uid), ['u1', 'u2']);
  // The flag bitfield must survive intact -- these drive the Cleanup lists.
  const rb = back.playlists[0].tracks[1];
  assert.equal(rb.isPlayable, false);
  assert.equal(rb.isLocal, true);
  assert.equal(rb.isExplicit, true);
  assert.equal(back.liked[0].addedAt, '2021-02-03T04:05:06.000Z');
});

test('artist names containing a comma survive the round trip', () => {
  // Names are packed into one string. Joining on ", " -- the form the UI shows
  // -- would split "Tyler, The Creator" back into two artists.
  clearScan();
  const t = track('a', { artists: ['Tyler, The Creator', 'Earl'] });
  saveScan(scanOf({ liked: [t] }));
  assert.deepEqual(loadScan().liked[0].artists.map((a) => a.name), ['Tyler, The Creator', 'Earl']);
});

test('the round trip preserves what the index derives from it', () => {
  clearScan();
  const a = track('a', { artists: ['X'] });
  const b = track('b', { artists: ['X', 'Y'] });
  const scan = scanOf({
    liked: [a],
    playlists: [{ uri: 'spotify:playlist:x', tracks: [row(a, 'u1'), row(b, 'u2')] }],
  });
  saveScan(scan);
  const before = computeStats(scan, buildIndex(scan));
  const after = computeStats(loadScan(), buildIndex(loadScan()));
  assert.equal(after.uniqueTracks, before.uniqueTracks);
  assert.equal(after.totalRows, before.totalRows);
  assert.equal(after.uniqueArtists, before.uniqueArtists);
  assert.deepEqual(after.topArtists, before.topArtists);
});

test('a track with no artists round trips as no artists, not one empty one', () => {
  clearScan();
  const t = { ...track('a'), artists: [] };
  saveScan(scanOf({ liked: [t] }));
  assert.deepEqual(loadScan().liked[0].artists, []);
});

test('an unreadable or foreign payload is ignored rather than thrown', () => {
  // The warning this path emits is the point of it; muted so a real failure
  // elsewhere is not buried under an expected stack trace.
  const warn = console.warn;
  console.warn = () => {};
  try {
  clearScan();
  assert.equal(loadScan(), null);
  globalThis.localStorage.setItem('iceni:library-manager:scan', 'not json');
  assert.equal(loadScan(), null);
  globalThis.localStorage.setItem('iceni:library-manager:scan', JSON.stringify({ v: 99 }));
  assert.equal(loadScan(), null);
  clearScan();
  } finally {
    console.warn = warn;
  }
});

test('describeAge reads in plain units', () => {
  const now = Date.now();
  assert.equal(describeAge(now), 'just now');
  assert.equal(describeAge(now - 5 * 60_000), '5 minutes ago');
  assert.equal(describeAge(now - 60 * 60_000), '1 hour ago');
  assert.equal(describeAge(now - 48 * 60 * 60_000), '2 days ago');
});

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
