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
// { uri, uid }, and PlaylistAPI.add takes (uri, uris).

export function unlikeTracks(uris: string[]): Promise<void> {
  return platform().LibraryAPI.remove({ uris });
}

export function likeTracks(uris: string[]): Promise<void> {
  return platform().LibraryAPI.add({ uris });
}

export function removeFromPlaylist(
  playlistUri: string,
  rows: Array<{ uri: string; uid: string }>,
): Promise<void> {
  return platform().PlaylistAPI.remove(playlistUri, rows);
}

export function addToPlaylist(playlistUri: string, uris: string[]): Promise<void> {
  return platform().PlaylistAPI.add(playlistUri, uris);
}

export function navigateTo(uri: string): void {
  const [, type, id] = uri.split(':');
  if (type && id) platform().History.push(`/${type}/${id}`);
}
