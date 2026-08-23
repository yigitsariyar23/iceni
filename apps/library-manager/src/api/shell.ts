// Giving the dashboard the window.
//
// This is a dense page -- a wide table with six or seven columns -- sharing a
// window with Spotify's library sidebar on the left and the now-playing panel
// on the right, which together take most of the width. While the route is
// open both are pushed out of the way, and whatever they were is put back on
// the way out.
//
// The client keeps both in LocalStorageAPI and drives its own layout off
// those keys, so writing them is enough; there is no need to find and click
// the collapse controls, which have no stable selector.

/** Widths the client itself uses for the left sidebar; 72 is its collapsed rail. */
const LEFT_COLLAPSED = 1;
const LEFT_KEY = 'left-sidebar-state';
const RIGHT_KEY = 'right-sidebar-open';

type Saved = { left: unknown; right: unknown } | null;

const storage = () => Spicetify.Platform?.LocalStorageAPI;

function read(key: string): unknown {
  try {
    return storage()?.getItem(key);
  } catch (e) {
    console.warn('[library-manager] could not read', key, e);
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, value);
  } catch (e) {
    console.warn('[library-manager] could not set', key, e);
  }
}

/**
 * Collapses both side panels and returns what they were, for restore().
 * Returns null when the storage API is missing, in which case restore() is a
 * no-op and the page simply renders in whatever width it was given.
 */
export function collapseChrome(): Saved {
  if (!storage()) return null;
  const saved: Saved = { left: read(LEFT_KEY), right: read(RIGHT_KEY) };
  write(LEFT_KEY, LEFT_COLLAPSED);
  write(RIGHT_KEY, false);
  return saved;
}

export function restoreChrome(saved: Saved): void {
  if (!saved || !storage()) return;
  // Only put back values that were actually there. Writing `undefined` over a
  // key the client has never set makes it read as set-to-nothing rather than
  // absent, and the sidebar comes back at a width of zero.
  if (saved.left !== undefined && saved.left !== null) write(LEFT_KEY, saved.left);
  if (saved.right !== undefined && saved.right !== null) write(RIGHT_KEY, saved.right);
}
