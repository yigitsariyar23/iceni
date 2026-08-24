// Tests for the derived views. These decide which rows a bulk action deletes,
// so they are worth pinning down: a duplicate group that keeps the wrong copy,
// or an "unfiled" list that quietly includes filed tracks, is destructive.
//
// Run with: npm test

import assert from 'node:assert/strict';
import { buildIndex, computeStats, findDuplicates } from '../dist-test/api/scan.mjs';
import { buildExport, exportFileName } from '../dist-test/api/export.mjs';
import { loadScan, saveScan, clearScan, describeAge } from '../dist-test/api/cache.mjs';
import { COLUMNS, loadVisible, saveVisible, playlistNamesOf } from '../dist-test/ui/columns.mjs';
import { fmtTrackLength, fmtDuration } from '../dist-test/ui/format.mjs';
import { isStale, MAX_AGE_MS } from '../dist-test/api/playcounts.mjs';
import { FACETS, applyFacets, nextFacet } from '../dist-test/ui/facets.mjs';
import { shouldDismiss } from '../dist-test/ui/dismiss.mjs';
import { moveColumn, reconcile } from '../dist-test/ui/columnOrder.mjs';
import { canStartMarquee } from '../dist-test/ui/marqueeStart.mjs';
import { clampColumnWidth, gutters } from '../dist-test/ui/gridWidth.mjs';
import { applyPlaylistFilter, nextMode, splitFilters, withMode } from '../dist-test/ui/playlistFilter.mjs';

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

/**
 * Stand-in for the one Element method these checks use. `tokens` are what the
 * element and its ancestors would match -- class names without the dot, or
 * tag names -- and closest() understands a comma-separated selector list, as
 * the real one does.
 */
const target = (...tokens) => ({
  closest: (sel) =>
    sel.split(',').map((s) => s.trim().replace(/^\./, '')).some((t) => tokens.includes(t))
      ? {}
      : null,
});

/** A TrackRef as buildIndex would produce, for the column and facet tests. */
const facetRow = (over) => ({
  uri: over.uri ?? 'spotify:track:x', name: 'n', artistNames: '', artistUris: [],
  albumName: '', albumUri: '', durationMs: 0, isPlayable: over.isPlayable ?? true,
  isLocal: !!over.isLocal, isExplicit: !!over.isExplicit, addedAt: 0,
  liked: !!over.liked, playlists: over.playlists ?? [],
});

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

test('artist uris survive the round trip, so the artist cell can still link', () => {
  clearScan();
  const t = track('a', { artists: ['X', 'Y'] });
  saveScan(scanOf({ liked: [t] }));
  const back = loadScan().liked[0].artists;
  assert.deepEqual(back.map((a) => a.name), ['X', 'Y']);
  assert.deepEqual(back.map((a) => a.uri), t.artists.map((a) => a.uri));
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

// ── columns ──────────────────────────────────────────────────────────────

const LEGACY_COLS = 'iceni:library-manager:columns';
const HIDDEN_COLS = 'iceni:library-manager:columns-hidden';
const clearCols = () => {
  globalThis.localStorage.removeItem(LEGACY_COLS);
  globalThis.localStorage.removeItem(HIDDEN_COLS);
};
const defaultKeys = () => COLUMNS.filter((c) => c.on).map((c) => c.key);

test('the default column set is the ones marked on', () => {
  clearCols();
  assert.deepEqual(loadVisible(), defaultKeys());
});

test('a saved set round trips', () => {
  clearCols();
  saveVisible(['name', 'uri']);
  assert.deepEqual(loadVisible(), ['name', 'uri']);
});

test('a column added after the user last chose still shows up', () => {
  // The bug this replaces: the visible set was stored, so a column added in a
  // later build was absent from everyone's saved list and read as hidden for
  // good. Hiding one column must not hide the ones that do not exist yet.
  clearCols();
  saveVisible(defaultKeys().filter((k) => k !== 'album'));
  const visible = loadVisible();
  assert.equal(visible.includes('album'), false, 'the hidden one stays hidden');
  // Stand in for a future column: anything on by default and not switched off.
  for (const key of defaultKeys()) {
    if (key !== 'album') assert.ok(visible.includes(key), `${key} should still show`);
  }
});

test('a list saved under the old key is converted, not discarded', () => {
  clearCols();
  // What an older build wrote: the visible set, missing everything added since.
  globalThis.localStorage.setItem(LEGACY_COLS, JSON.stringify(['name', 'artist', 'album']));
  const visible = loadVisible();
  assert.ok(visible.includes('name') && visible.includes('artist'));
  // Columns the old list did not mention but that default to on come back --
  // the user never had the chance to turn them off.
  assert.ok(visible.includes('plays'), 'a newer default column should appear');
  // Ones that default to off stay off.
  assert.equal(visible.includes('uri'), false);
  assert.equal(globalThis.localStorage.getItem(LEGACY_COLS), null, 'legacy key is cleared');
});

test('hiding every column falls back to the defaults', () => {
  clearCols();
  globalThis.localStorage.setItem(HIDDEN_COLS, JSON.stringify(COLUMNS.map((c) => c.key)));
  assert.deepEqual(loadVisible(), defaultKeys());
  clearCols();
});

test('unknown keys in the stored set are ignored', () => {
  clearCols();
  globalThis.localStorage.setItem(HIDDEN_COLS, JSON.stringify(['bpm', 'album']));
  const visible = loadVisible();
  assert.equal(visible.includes('album'), false);
  assert.ok(visible.includes('name'));
  clearCols();
});

test('In playlists sorts on the names it shows, not on the count', () => {
  // The bug: it displayed names but sorted by t.playlists.length, so the
  // header appeared to do nothing and two different columns sorted alike.
  const names = new Map([['p:a', 'Zephyr'], ['p:b', 'Alpha'], ['p:c', 'Mid']]);
  const col = COLUMNS.find((c) => c.key === 'playlistNames');
  const ctx = { names, plays: {} };
  const one = facetRow({ uri: '1', playlists: ['p:a'] });        // Zephyr
  const two = facetRow({ uri: '2', playlists: ['p:b', 'p:c'] }); // Alpha, Mid
  assert.equal(col.sortBy(one, ctx), 'zephyr');
  assert.equal(col.sortBy(two, ctx), 'alpha, mid');
  // Sorting ascending must put Alpha first even though it has more playlists.
  const sorted = [one, two].sort((a, b) => String(col.sortBy(a, ctx)).localeCompare(String(col.sortBy(b, ctx))));
  assert.equal(sorted[0].uri, '2');
});

test('the playlist names in a row are alphabetical, not in scan order', () => {
  const names = new Map([['p:a', 'Zephyr'], ['p:b', 'Alpha']]);
  // Given in the order the rootlist walk produced them.
  const row = facetRow({ uri: '1', playlists: ['p:a', 'p:b'] });
  assert.deepEqual(playlistNamesOf(row, names).map((p) => p.name), ['Alpha', 'Zephyr']);
});

test('a playlist with no name falls back to its uri rather than blanking', () => {
  const row = facetRow({ uri: '1', playlists: ['p:missing'] });
  assert.deepEqual(playlistNamesOf(row, new Map()).map((p) => p.name), ['p:missing']);
});

// ── marquee start region ─────────────────────────────────────────────────

test('a press among the rows starts a band', () => {
  assert.equal(canStartMarquee(target('lm-grid__body', 'lm-grid__row'), '.lm-grid__body'), true);
});

test('a press on a column header does not', () => {
  // The bug: the band started anywhere in the grid, so dragging a header both
  // reordered the column and swept a selection across every row it crossed.
  assert.equal(canStartMarquee(target('lm-grid__head', 'lm-grid__hcell'), '.lm-grid__body'), false);
});

test('a press on a control never starts a band, wherever it is', () => {
  assert.equal(canStartMarquee(target('lm-grid__body', 'button'), '.lm-grid__body'), false);
  assert.equal(canStartMarquee(target('lm-grid__body', 'input'), '.lm-grid__body'), false);
  assert.equal(canStartMarquee(target('lm-grid__body', 'a'), '.lm-grid__body'), false);
});

test('a press outside the list entirely does not', () => {
  assert.equal(canStartMarquee(target('lm-filters'), '.lm-grid__body'), false);
  assert.equal(canStartMarquee(null, '.lm-grid__body'), false);
});

// ── playlist include / exclude ───────────────────────────────────────────

const pl = (uri, ...playlists) => facetRow({ uri, playlists });

test('including a playlist keeps only its tracks', () => {
  const rows = [pl('a', 'p1'), pl('b', 'p2'), pl('c')];
  assert.deepEqual(applyPlaylistFilter(rows, { p1: 1 }).map((r) => r.uri), ['a']);
});

test('two included playlists widen the result rather than narrowing it', () => {
  // Within one facet, choices are OR. "In Rock or Metal" is the question
  // people ask; "in both at once" is what the Playlists count column answers.
  const rows = [pl('a', 'p1'), pl('b', 'p2'), pl('c', 'p3'), pl('d', 'p1', 'p2')];
  assert.deepEqual(
    applyPlaylistFilter(rows, { p1: 1, p2: 1 }).map((r) => r.uri),
    ['a', 'b', 'd'],
  );
});

test('excluding a playlist means not in that one, not in none', () => {
  // The easy mistake: treating exclude as "unfiled", which would drop the
  // track that lives in a different playlist.
  const rows = [pl('a', 'p1'), pl('b', 'p2'), pl('c')];
  assert.deepEqual(applyPlaylistFilter(rows, { p1: -1 }).map((r) => r.uri), ['b', 'c']);
});

test('two excluded playlists both have to miss', () => {
  // Excludes are AND: an exclusion that only had to miss one of the two would
  // not exclude anything at all.
  const rows = [pl('a', 'p1'), pl('b', 'p2'), pl('c', 'p3'), pl('d')];
  assert.deepEqual(
    applyPlaylistFilter(rows, { p1: -1, p2: -1 }).map((r) => r.uri),
    ['c', 'd'],
  );
});

test('include and exclude combine', () => {
  const rows = [pl('a', 'p1'), pl('b', 'p1', 'p2'), pl('c', 'p2')];
  // In p1 but not in p2.
  assert.deepEqual(
    applyPlaylistFilter(rows, { p1: 1, p2: -1 }).map((r) => r.uri),
    ['a'],
  );
});

test('a track in both the excluded playlist and another is still dropped', () => {
  assert.deepEqual(applyPlaylistFilter([pl('a', 'p1', 'p2')], { p1: -1 }), []);
});

test('no playlist filter leaves the rows alone', () => {
  const rows = [pl('a', 'p1')];
  assert.equal(applyPlaylistFilter(rows, {}), rows);
});

test('splitFilters separates the two modes', () => {
  const { included, excluded } = splitFilters({ p1: 1, p2: -1, p3: 1 });
  assert.deepEqual(included.sort(), ['p1', 'p3']);
  assert.deepEqual(excluded, ['p2']);
});

test('picking the mode a playlist already has clears it', () => {
  assert.equal(nextMode(undefined, 1), 1);
  assert.equal(nextMode(1, 1), undefined);
  assert.equal(nextMode(1, -1), -1);
  assert.equal(nextMode(-1, -1), undefined);
});

test('withMode adds, flips and removes without touching the rest', () => {
  const base = { p1: 1, p2: -1 };
  assert.deepEqual(withMode(base, 'p3', 1), { p1: 1, p2: -1, p3: 1 });
  assert.deepEqual(withMode(base, 'p1', -1), { p1: -1, p2: -1 });
  assert.deepEqual(withMode(base, 'p1', undefined), { p2: -1 });
  assert.deepEqual(base, { p1: 1, p2: -1 }, 'the input is not mutated');
});

// ── column width clamp ───────────────────────────────────────────────────

// Three columns whose measured widths fill a 1000px row exactly.
const COLS = [{ key: 'a', min: 100 }, { key: 'b', min: 80 }, { key: 'c', min: 60 }];
const FULL = 1000;
const filled = () => {
  const room = FULL - gutters(COLS.length);
  return { a: room - 300, b: 200, c: 100 };
};

test('a column can be made wider by taking from the flexible one', () => {
  // The bug: the flexible column was counted at its current width, so the
  // others already added up to the whole row and the ceiling landed on the
  // dragged column's own width. Nothing could grow -- only shrink.
  const widths = filled();
  const out = clampColumnWidth({
    wanted: widths.b + 150, columns: COLS, widths,
    draggedKey: 'b', flexibleKey: 'a', containerWidth: FULL,
  });
  assert.equal(out, widths.b + 150, 'should get the width it asked for');
});

test('a column cannot grow past what the flexible one can give up', () => {
  const widths = filled();
  const room = FULL - gutters(COLS.length);
  const out = clampColumnWidth({
    wanted: 100_000, columns: COLS, widths,
    draggedKey: 'b', flexibleKey: 'a', containerWidth: FULL,
  });
  // Everything else at its floor, except the untouched fixed column.
  assert.equal(out, room - 100 /* a.min */ - widths.c);
  assert.ok(out < 100_000);
});

test('a column never goes below its own minimum', () => {
  const widths = filled();
  const out = clampColumnWidth({
    wanted: 5, columns: COLS, widths,
    draggedKey: 'b', flexibleKey: 'a', containerWidth: FULL,
  });
  assert.equal(out, 80);
});

test('the clamped row still fits the container', () => {
  const widths = filled();
  const b = clampColumnWidth({
    wanted: 100_000, columns: COLS, widths,
    draggedKey: 'b', flexibleKey: 'a', containerWidth: FULL,
  });
  const total = 100 /* a at its min */ + b + widths.c + gutters(COLS.length);
  assert.ok(total <= FULL, `row of ${total} must fit ${FULL}`);
});

test('with no flexible column the others are counted as they are', () => {
  const widths = filled();
  const out = clampColumnWidth({
    wanted: 100_000, columns: COLS, widths,
    draggedKey: 'b', containerWidth: FULL,
  });
  assert.equal(out, FULL - gutters(COLS.length) - widths.a - widths.c);
});

// ── column order ─────────────────────────────────────────────────────────

test('a column moved left lands where the indicator was', () => {
  const order = ['a', 'b', 'c', 'd'];
  // Dropping "c" on the gap before index 1 makes it the second column.
  assert.deepEqual(moveColumn(order, 'c', 1), ['a', 'c', 'b', 'd']);
  assert.deepEqual(moveColumn(order, 'd', 0), ['d', 'a', 'b', 'c']);
});

test('a column moved right lands where the indicator was, not one short', () => {
  // Taking the column out shifts everything after it left by one, so a drop
  // past its old position has to come back by one to land where it looked.
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveColumn(order, 'a', 2), ['b', 'a', 'c', 'd']);
  assert.deepEqual(moveColumn(order, 'a', 4), ['b', 'c', 'd', 'a']);
});

test('dropping a column where it already is changes nothing', () => {
  const order = ['a', 'b', 'c'];
  assert.deepEqual(moveColumn(order, 'b', 1), order);
  assert.deepEqual(moveColumn(order, 'b', 2), order);
});

test('moving a column that is not in the order is a no-op', () => {
  const order = ['a', 'b'];
  assert.equal(moveColumn(order, 'zz', 0), order);
});

test('a stored order is reconciled against the catalogue', () => {
  const known = COLUMNS.map((c) => c.key);
  // Unknown keys are dropped: one would leave a grid track with no header and
  // no cells, shifting every column after it.
  const withJunk = reconcile([...known.slice(0, 3), 'bpm', 'key']);
  assert.deepEqual(withJunk.slice(0, 3), known.slice(0, 3));
  assert.equal(withJunk.length, known.length);
  assert.equal(withJunk.includes('bpm'), false);
});

test('columns added since the order was saved are appended, not lost', () => {
  const known = COLUMNS.map((c) => c.key);
  const partial = reconcile(known.slice(0, 2));
  assert.deepEqual(partial.slice(0, 2), known.slice(0, 2));
  assert.equal(partial.length, known.length, 'every catalogue column is present');
  assert.deepEqual([...new Set(partial)].length, partial.length, 'no duplicates');
});

test('a duplicated key in the stored order appears once', () => {
  const out = reconcile(['name', 'name', 'artist']);
  assert.equal(out.filter((k) => k === 'name').length, 1);
});

test('no stored order at all gives the catalogue order', () => {
  assert.deepEqual(reconcile(null), COLUMNS.map((c) => c.key));
  assert.deepEqual(reconcile('nonsense'), COLUMNS.map((c) => c.key));
});

test('no two columns share a label', () => {
  // "Plays" was on both the play-count column and the playable flag, which
  // rendered as two columns with the same heading, one of them always empty.
  const labels = COLUMNS.map((c) => c.label);
  assert.deepEqual([...new Set(labels)].length, labels.length, `duplicate label in ${labels}`);
});

test('every column either sorts or says it does not', () => {
  for (const c of COLUMNS) {
    assert.equal(typeof c.render, 'function', `${c.key} must render`);
    assert.ok(c.min > 0, `${c.key} needs a minimum width`);
    assert.ok(c.track, `${c.key} needs a grid track`);
  }
});

// ── formatting ───────────────────────────────────────────────────────────

test('a track length reads as minutes and seconds', () => {
  assert.equal(fmtTrackLength(222_000), '3:42');
  assert.equal(fmtTrackLength(65_000), '1:05');
  assert.equal(fmtTrackLength(9_000), '0:09');
  assert.equal(fmtTrackLength(3_735_000), '1:02:15');
  assert.equal(fmtTrackLength(0), '—');
});

test('a library total still reads in coarse units', () => {
  // The two formatters answer different questions and must not be merged back.
  assert.equal(fmtDuration(222_000), '4m');
  assert.equal(fmtDuration(3_735_000), '1h 2m');
});

// ── facets ───────────────────────────────────────────────────────────────


test('a facet includes on 1 and excludes on -1', () => {
  const liked = facetRow({ uri: 'a', liked: true });
  const notLiked = facetRow({ uri: 'b', liked: false });
  const rows = [liked, notLiked];
  assert.deepEqual(applyFacets(rows, {}), rows, 'neutral leaves the rows alone');
  assert.deepEqual(applyFacets(rows, { liked: 1 }), [liked]);
  assert.deepEqual(applyFacets(rows, { liked: -1 }), [notLiked]);
});

test('facets combine, which the old single-choice dropdown could not express', () => {
  const likedFiled = facetRow({ uri: 'a', liked: true, playlists: ['p'] });
  const likedLoose = facetRow({ uri: 'b', liked: true, playlists: [] });
  const unlikedLoose = facetRow({ uri: 'c', liked: false, playlists: [] });
  const rows = [likedFiled, likedLoose, unlikedLoose];
  // "liked but not filed"
  assert.deepEqual(applyFacets(rows, { liked: 1, filed: -1 }), [likedLoose]);
  // "not liked and not filed" -- unreachable before
  assert.deepEqual(applyFacets(rows, { liked: -1, filed: -1 }), [unlikedLoose]);
});

test('filed means in at least one playlist', () => {
  const filed = facetRow({ uri: 'a', playlists: ['p1', 'p2'] });
  const loose = facetRow({ uri: 'b', playlists: [] });
  assert.deepEqual(applyFacets([filed, loose], { filed: 1 }), [filed]);
  assert.deepEqual(applyFacets([filed, loose], { filed: -1 }), [loose]);
});

test('clicking the state it is already in clears it', () => {
  assert.equal(nextFacet(undefined, 1), 1);
  assert.equal(nextFacet(1, 1), undefined);
  assert.equal(nextFacet(undefined, -1), -1);
  assert.equal(nextFacet(-1, -1), undefined);
  // Flipping goes straight across rather than through neutral.
  assert.equal(nextFacet(1, -1), -1);
  assert.equal(nextFacet(-1, 1), 1);
});

test('every facet has both labels and a test', () => {
  for (const f of FACETS) {
    assert.ok(f.on && f.off && f.on !== f.off, `${f.key} needs two distinct labels`);
    assert.equal(typeof f.test, 'function');
  }
});

// ── context menu dismissal ───────────────────────────────────────────────


test('a press inside the menu does not dismiss it', () => {
  // The bug: dismissal was unconditional and ran on mousedown in the capture
  // phase, so pressing an item unmounted the button before the press became a
  // click. No menu entry in the app ever fired.
  assert.equal(shouldDismiss(target('lm-menu')), false);
});

test('a press in a submenu does not dismiss it either', () => {
  // Submenus carry lm-menu too, so the same check covers both levels.
  assert.equal(shouldDismiss(target('lm-menu', 'lm-menu--sub')), false);
});

test('a press anywhere else dismisses the menu', () => {
  assert.equal(shouldDismiss(target('lm-grid__row')), true);
  assert.equal(shouldDismiss(target()), true);
  assert.equal(shouldDismiss(null), true);
});

test('play counts go stale after a week', () => {
  assert.equal(isStale(null), true);
  assert.equal(isStale({ at: Date.now(), counts: {} }), false);
  assert.equal(isStale({ at: Date.now() - MAX_AGE_MS + 60_000, counts: {} }), false);
  assert.equal(isStale({ at: Date.now() - MAX_AGE_MS - 60_000, counts: {} }), true);
});

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
