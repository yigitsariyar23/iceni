// Thin, typed wrappers over the Platform APIs.
//
// Two things here are not obvious and both were established by probing the
// running client rather than by reading the docs:
//
//   1. `totalLength` on the liked-songs page is 0 even when the page is full,
//      so nothing may paginate off it. Every loop below stops on a short page
//      and carries its own hard cap instead.
//   2. Playlist rows are addressed by `uid`, not by track uri. A playlist can
//      hold the same track twice, and removing by uri takes both copies.

const PAGE = 200;

/** Guard rail: stops a runaway loop from hammering the client forever. */
const MAX_PAGES = 400;

const platform = () => Spicetify.Platform;

export type Progress = (done: number, label: string) => void;

async function paginate<T>(
  fetchPage: (offset: number, limit: number) => Promise<Page<T>>,
  onPage?: (soFar: number) => void,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchPage(all.length, PAGE);
    const items = res?.items ?? [];
    all.push(...items);
    onPage?.(all.length);
    if (items.length < PAGE) break;
  }
  return all;
}

export function getLikedTracks(onPage?: (n: number) => void): Promise<LibraryTrack[]> {
  return paginate(
    (offset, limit) => platform().LibraryAPI.getTracks({ offset, limit }),
    onPage,
  );
}

export function getPlaylistTracks(uri: string): Promise<PlaylistTrack[]> {
  return paginate((offset, limit) => platform().PlaylistAPI.getContents(uri, { offset, limit }));
}

export interface PlaylistNode {
  uri: string;
  name: string;
  /** Folder names from the root down, empty for a playlist sitting at top level. */
  folders: string[];
  owner?: string;
  isOwnedBySelf: boolean;
  description?: string;
  image?: string;
}

export interface RootlistShape {
  playlists: PlaylistNode[];
  folderCount: number;
  emptyFolders: string[];
}

/**
 * The rootlist arrives as one tree. Its per-playlist metadata is only
 * hydrated for playlists the client has already opened -- totalLength and
 * canEditItems read 0/false for the rest -- so nothing downstream may trust
 * those fields. Only identity and position are taken from here; counts come
 * from the contents call.
 */
export async function getRootlist(): Promise<RootlistShape> {
  const root = await platform().RootlistAPI.getContents();
  const playlists: PlaylistNode[] = [];
  const emptyFolders: string[] = [];
  let folderCount = 0;

  const walk = (node: RootlistFolder, folders: string[]) => {
    for (const item of node.items ?? []) {
      if (item.type === 'folder') {
        folderCount++;
        const path = [...folders, item.name];
        if (!(item.items ?? []).length) emptyFolders.push(path.join(' / '));
        walk(item, path);
      } else {
        playlists.push({
          uri: item.uri,
          name: item.name,
          folders,
          owner: item.owner?.displayName ?? item.owner?.username,
          isOwnedBySelf: !!item.isOwnedBySelf,
          description: item.description,
          image: item.images?.[0]?.url,
        });
      }
    }
  };
  walk(root, []);
  return { playlists, folderCount, emptyFolders };
}

// ── Mutations ────────────────────────────────────────────────────────────
// Signatures verified against the client's own implementations: LibraryAPI
// takes { uris }, PlaylistAPI.remove takes (uri, rows) where a row is
// { uri, uid }, and PlaylistAPI.add takes (uri, uris, position).

export function unlikeTracks(uris: string[]): Promise<void> {
  return platform().LibraryAPI.remove({ uris });
}

export function likeTracks(uris: string[]): Promise<void> {
  return platform().LibraryAPI.add({ uris });
}

/**
 * How many of these are in Liked Songs right now.
 *
 * LibraryAPI.add resolves whether or not the library took the tracks -- a
 * local file, or one unavailable in this market, is dropped without a word --
 * so a write is confirmed by reading it back rather than by the call
 * returning.
 */
export async function countLiked(uris: string[]): Promise<number> {
  if (!uris.length) return 0;
  try {
    const found = await platform().LibraryAPI.contains(...uris);
    return found.filter(Boolean).length;
  } catch (e) {
    // Unverifiable is not the same as failed: say nothing rather than claim
    // the write did not happen.
    console.warn('[library-manager] could not confirm the library write', e);
    return uris.length;
  }
}

export function removeFromPlaylist(
  playlistUri: string,
  rows: Array<{ uri: string; uid: string }>,
): Promise<void> {
  return platform().PlaylistAPI.remove(playlistUri, rows);
}

/**
 * Appends tracks to a playlist.
 *
 * The position argument is not optional, whatever its call sites make it look
 * like: the client destructures it unconditionally, so omitting it throws
 * "Cannot destructure property 'before' of 'e'" before the request is built.
 * `{ after: 'end' }` is what the client's own "Add to playlist" passes, and it
 * is what the confirmation dialog here promises -- appended, not prepended.
 */
export function addToPlaylist(playlistUri: string, uris: string[]): Promise<void> {
  return platform().PlaylistAPI.add(playlistUri, uris, { after: 'end' });
}

/**
 * Removes playlists from the library. Verified against the client's own
 * implementation: RootlistAPI.remove takes rows and reads `uid ?? uri`, so a
 * bare uri is a valid row.
 *
 * This is the one destructive action in the app Spotify can undo: a deleted
 * playlist stays recoverable from the account page for 90 days. Removing a
 * track from a playlist, or unliking one, cannot be undone at all.
 */
export function removePlaylists(uris: string[]): Promise<void> {
  return platform().RootlistAPI.remove(uris.map((uri) => ({ uri })));
}

export function navigateTo(uri: string): void {
  const [, type, id] = uri.split(':');
  if (type && id) platform().History.push(`/${type}/${id}`);
}

/** Leaves the dashboard for wherever the user was before it. */
export function goBack(): void {
  platform().History.goBack();
}

/**
 * Plays a single track. PlayerAPI.play takes a context, and a bare track uri
 * is a valid one -- it is what the client's own playUri helper passes.
 */
/**
 * Plays a track, from a context where there is one.
 *
 * play(context, origin, options) with options.skipTo -- the same shape the
 * client's own rows use, verified against its implementation. Passing the
 * track as the context instead leaves the queue holding one item, so whatever
 * follows is Spotify's choice rather than the rest of the playlist.
 */
export function playTrack(trackUri: string, contextUri?: string | null): void {
  const context = contextUri ? { uri: contextUri } : { uri: trackUri };
  const options = contextUri ? { skipTo: { uri: trackUri } } : {};
  void platform()
    .PlayerAPI.play(context, { featureIdentifier: 'library_manager' }, options)
    .catch((e: unknown) => {
      console.error('[library-manager] could not play', trackUri, 'from', contextUri, e);
    });
}

/**
 * Queue actions. Both take { uri } objects rather than bare strings -- the
 * client's own call sites map `uri => ({ uri })` before calling, and a bare
 * string is accepted and then quietly ignored.
 *
 * Neither touches the library, so unlike the other bulk actions here they are
 * cheap to undo: the queue can be cleared.
 */
export async function addToQueue(uris: string[]): Promise<void> {
  await platform().PlayerAPI.addToQueue(uris.map((uri) => ({ uri })));
}

export async function playNext(uris: string[]): Promise<void> {
  // Reversed: each is inserted at the front, so the last one in ends up first
  // out. Handing them over in order would play the selection backwards.
  await platform().PlayerAPI.playAsNextInQueue([...uris].reverse().map((uri) => ({ uri })));
}

/**
 * The Liked Songs pseudo-playlist, so a liked track with no playlist still has
 * somewhere to continue from. It is a private field on the API; absent, tracks
 * simply play alone.
 */
export function likedSongsUri(): string | null {
  try {
    const api = platform().LibraryAPI as unknown as { _likedSongsUri?: string };
    return api._likedSongsUri ?? null;
  } catch {
    return null;
  }
}
