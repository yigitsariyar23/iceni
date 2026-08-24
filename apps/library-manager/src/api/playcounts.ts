// Global play counts.
//
// This is the number Spotify shows on an album page: how many times everyone
// has played a track, not how many times you have. Your own count is not
// exposed anywhere in the client -- it only exists in the extended streaming
// history you can request from your account -- so this is the only play count
// there is to have.
//
// It is also only available per album: there is no bulk track endpoint, so a
// full pass is one getAlbum query per distinct album in the library. That is
// several hundred requests, which is why it runs once a week in the background
// rather than as part of every scan.

const KEY = 'iceni:library-manager:playcounts';
const VERSION = 1;

/** A week. The number moves slowly and nothing here depends on it being exact. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Albums in flight at once. Enough to be quick, not enough to be a stampede. */
const CONCURRENCY = 4;

/** getAlbum's own page size, as the client calls it. */
const TRACK_LIMIT = 50;

export interface PlaycountCache {
  at: number;
  counts: Record<string, number>;
}

export function loadPlaycounts(): PlaycountCache | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlaycountCache & { v?: number };
    if (parsed?.v !== VERSION || typeof parsed.counts !== 'object') return null;
    return { at: parsed.at, counts: parsed.counts };
  } catch (e) {
    console.warn('[library-manager] play counts unreadable', e);
    return null;
  }
}

export function savePlaycounts(cache: PlaycountCache): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, ...cache }));
  } catch (e) {
    console.warn('[library-manager] could not cache play counts', e);
  }
}

export const isStale = (cache: PlaycountCache | null) =>
  !cache || Date.now() - cache.at > MAX_AGE_MS;

/**
 * Pulls every { uri, playcount } pair out of a response without knowing where
 * they sit. The shape is albumUnion.tracksV2.items[].track, but that path has
 * been renamed more than once across client versions and this enrichment is
 * not worth breaking over a rename -- a walk finds them wherever they are.
 */
function harvest(node: unknown, into: Record<string, number>, depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 8) return;
  if (Array.isArray(node)) {
    for (const item of node) harvest(item, into, depth + 1);
    return;
  }
  const record = node as Record<string, unknown>;
  const uri = record.uri;
  const raw = record.playcount;
  if (typeof uri === 'string' && uri.startsWith('spotify:track:') && raw != null) {
    const count = Number(raw);
    // "0" is what the client fills in when it has no figure, not a real zero.
    if (Number.isFinite(count) && count > 0) into[uri] = count;
  }
  for (const value of Object.values(record)) harvest(value, into, depth + 1);
}

/**
 * Spicetify.GraphQL.Request is a getter over Platform.GraphQLLoader, and
 * Platform is attached a couple of seconds after the client boots -- the
 * definitions are there from the first frame, but the transport is not. Asking
 * too early used to fail every album in turn and cache nothing, silently.
 */
async function waitForGraphQL(timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const graph = Spicetify.GraphQL;
    if (graph?.Request && graph?.Definitions?.getAlbum) return;
    if (Date.now() > deadline) {
      throw new Error('Spotify\'s GraphQL transport never became available');
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function fetchAlbum(uri: string): Promise<Record<string, number>> {
  const graph = Spicetify.GraphQL;
  const definition = graph?.Definitions?.getAlbum;
  if (!graph?.Request || !definition) throw new Error('GraphQL is not available');
  const locale = (() => {
    try { return Spicetify.Locale?.getLocale?.() ?? ''; } catch { return ''; }
  })();
  const res = await graph.Request(definition, { uri, locale, offset: 0, limit: TRACK_LIMIT });
  const out: Record<string, number> = {};
  harvest((res as { data?: unknown })?.data, out);
  return out;
}

export interface PlaycountProgress {
  done: number;
  total: number;
  failed: number;
}

export interface PlaycountResult {
  counts: Record<string, number>;
  failed: number;
  total: number;
}

/**
 * Walks the albums and returns what it found. Albums that fail are skipped
 * rather than aborting the pass: one unavailable album should not cost the
 * other eight hundred.
 */
export async function fetchPlaycounts(
  albumUris: string[],
  report: (p: PlaycountProgress) => void,
  shouldStop: () => boolean = () => false,
): Promise<PlaycountResult> {
  await waitForGraphQL();

  const counts: Record<string, number> = {};
  let done = 0;
  let failed = 0;
  let next = 0;
  let firstError: unknown = null;

  const worker = async () => {
    for (;;) {
      if (shouldStop()) return;
      const i = next++;
      if (i >= albumUris.length) return;
      try {
        Object.assign(counts, await fetchAlbum(albumUris[i]!));
      } catch (e) {
        failed++;
        if (!firstError) firstError = e;
      }
      done++;
      if (done % 10 === 0 || done === albumUris.length) {
        report({ done, total: albumUris.length, failed });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, albumUris.length) }, worker),
  );

  // Every album failing is a broken transport, not eight hundred unlucky
  // albums, and it used to be indistinguishable from a library with no play
  // counts because both cached an empty map.
  if (done > 0 && failed === done) {
    throw new Error(
      `Could not read play counts for any album: ${String((firstError as Error)?.message ?? firstError)}`,
    );
  }
  return { counts, failed, total: albumUris.length };
}
