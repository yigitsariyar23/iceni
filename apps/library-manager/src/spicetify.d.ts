// Types for the slice of Spicetify this app touches.
//
// Spicetify ships a globals.d.ts, but it declares Platform as `any`, which is
// exactly the part that matters here. Every shape below was read off the
// running client with a probe rather than guessed, and the field lists are
// what 1.2.97 actually returns -- see api/platform.ts for the call sites.

import type * as React from 'react';

export {};

declare global {
  namespace Spicetify {
    const React: typeof import('react');
    const ReactDOM: typeof import('react-dom');
    const Platform: Platform;
    const URI: {
      fromString(uri: string): { type: string; id?: string };
      isTrack(uri: unknown): boolean;
    };
    function showNotification(message: string, isError?: boolean, msTimeout?: number): void;
    const Locale: { get(key: string): string; getLocale(): string } | undefined;
    /** The wrapper's own player facade; `data` mirrors the client's state. */
    const Player: {
      data?: { item?: { uri?: string }; isPaused?: boolean };
      addEventListener(name: string, cb: () => void): void;
      removeEventListener(name: string, cb: () => void): void;
    } | undefined;
    /**
     * Request resolves to Platform.GraphQLLoader; the definitions are the
     * client's own persisted queries, registered as it loads them.
     */
    const GraphQL: {
      Request?: (definition: unknown, variables: Record<string, unknown>) => Promise<unknown>;
      Definitions?: Record<string, unknown>;
    } | undefined;
    namespace ReactComponent {
      const TooltipWrapper: React.FC<{
        label: string;
        children: React.ReactElement;
        placement?: string;
      }>;
      const ConfirmDialog: React.FC<Record<string, unknown>>;
    }
    const PopupModal: {
      display(o: { title: string; content: HTMLElement | React.ReactElement; isLarge?: boolean }): void;
      hide(): void;
    };
  }

  interface Platform {
    LibraryAPI: LibraryAPI;
    RootlistAPI: RootlistAPI;
    PlaylistAPI: PlaylistAPI;
    PlayerAPI: PlayerAPI;
    LocalStorageAPI: LocalStorageAPI;
    History: {
      push(path: string | { pathname: string }): void;
      goBack(): void;
      listen(fn: (location: { pathname: string }) => void): () => void;
      location: { pathname: string };
    };
  }

  /** An artist or album reference as it appears inside a track. */
  interface EntityRef {
    type: string;
    uri: string;
    name: string;
    images?: Array<{ url: string; label?: string }>;
  }

  /** A track as returned by LibraryAPI.getTracks. */
  interface LibraryTrack {
    type: string;
    uri: string;
    name: string;
    duration: { milliseconds: number };
    album: EntityRef;
    artists: EntityRef[];
    discNumber: number;
    trackNumber: number;
    isExplicit: boolean;
    isPlayable: boolean;
    isLocal: boolean;
    addedAt: string;
    isBanned?: boolean;
  }

  /**
   * A track as returned by PlaylistAPI.getContents. Flat, like LibraryTrack,
   * plus the row identity: `uid` is the handle the remove and move calls take,
   * and it is the only safe way to address a row -- the same track can sit in
   * a playlist more than once.
   */
  interface PlaylistTrack extends LibraryTrack {
    uid: string;
    playIndex?: number;
    addedBy?: { uri: string; username?: string; displayName?: string };
  }

  /** A playlist as it appears in the rootlist tree. */
  interface RootlistPlaylist {
    type: 'playlist';
    uri: string;
    name: string;
    description?: string;
    images?: Array<{ url: string; label?: string }>;
    owner?: { uri: string; username?: string; displayName?: string };
    /** Lazily hydrated: 0 or absent for playlists the client has not opened. */
    totalLength?: number;
    isLoaded?: boolean;
    isOwnedBySelf?: boolean;
    canEditItems?: boolean;
    isPublished?: boolean;
  }

  interface RootlistFolder {
    type: 'folder';
    uri: string;
    name: string;
    items: Array<RootlistPlaylist | RootlistFolder>;
    totalItemCount?: number;
  }

  interface Page<T> {
    items: T[];
    offset: number;
    limit: number;
    /** Unreliable on the liked-songs list: reads 0 even with items present. */
    totalLength: number;
    unfilteredTotalLength?: number;
  }

  interface LibraryAPI {
    getTracks(o?: {
      limit?: number;
      offset?: number;
      sort?: { field: string; order: string };
      filters?: string[];
    }): Promise<Page<LibraryTrack>>;
    getContents(o?: {
      limit?: number;
      offset?: number;
      filters?: string[];
      textFilter?: string;
      sortOrder?: string;
    }): Promise<
      Page<Record<string, unknown>> & {
        availableFilters: Array<{ id: string; name: string }>;
        availableSortOrders: Array<{ id: string; name: string }>;
      }
    >;
    add(o: { uris: string[]; silent?: boolean }): Promise<void>;
    remove(o: { uris: string[]; silent?: boolean }): Promise<void>;
    contains(...uris: string[]): Promise<boolean[]>;
  }

  interface RootlistAPI {
    /** Returns the whole tree in one call, rooted at a synthetic folder. */
    getContents(o?: Record<string, unknown>): Promise<RootlistFolder>;
    createPlaylist(name: string, position: unknown, uris?: string[]): Promise<string>;
    /** Rows are read as `uid ?? uri`, so `{ uri }` alone addresses a playlist. */
    remove(rows: Array<{ uri: string; uid?: string }>): Promise<void>;
  }

  /**
   * Where an add or a move lands. 'start'/'end' are the literal ends; an
   * object addresses a row, by uid where it has one and by uri otherwise.
   */
  type PlaylistAnchor = { uid: string } | { uri: string };
  type PlaylistPosition =
    | { before: 'start' | PlaylistAnchor }
    | { after: 'end' | PlaylistAnchor };

  interface PlaylistAPI {
    getContents(uri: string, o?: { limit?: number; offset?: number }): Promise<Page<PlaylistTrack>>;
    getMetadata(uri: string, o?: Record<string, unknown>): Promise<RootlistPlaylist>;
    /**
     * Position is required -- the client destructures it without a guard, so
     * `undefined` throws rather than defaulting to the end.
     */
    add(uri: string, uris: string[], position: PlaylistPosition): Promise<void>;
    /** Rows are addressed by uid; uri alone would hit every copy of a track. */
    remove(uri: string, rows: Array<{ uri: string; uid: string }>): Promise<void>;
  }

  interface LocalStorageAPI {
    getItem(key: string): unknown;
    setItem(key: string, value: unknown): void;
  }

  interface PlayerAPI {
    /** options.skipTo picks the starting row within the context. */
    play(
      context: { uri: string },
      origin?: Record<string, unknown>,
      options?: { skipTo?: { uri?: string; index?: number } },
    ): Promise<void>;
    addToQueue(items: Array<{ uri: string }>, options?: unknown): Promise<void>;
    playAsNextInQueue(items: Array<{ uri: string }>): Promise<void>;
  }
}
