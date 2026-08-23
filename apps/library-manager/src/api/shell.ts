// Giving the dashboard the window.
//
// This is a dense page sharing a window with the library sidebar on the left
// and the now-playing panel on the right, which together take most of the
// width. While the route is open both get out of the way; whatever they were
// is put back on the way out.
//
// Writing the client's own LocalStorageAPI keys was tried first and did
// nothing -- React reads them once and drives the layout off its own state, so
// a later write is never observed. This works the DOM instead, in two layers:
//
//   1. Click the client's own collapse control. That produces the real
//      collapsed rail -- icons, correct paddings, the client's animation --
//      which no amount of CSS from outside would reproduce faithfully.
//   2. Whatever happens, pin the widths from CSS as well, so a control that
//      moved or was renamed still leaves the page with its space.
//
// The buttons are found by their aria-label read out of Spotify's own
// dictionary rather than hardcoded in English, the same approach the context
// menu's library toggles use.

const BODY_CLASS = 'lm-chrome-collapsed';

const LABELS = {
  collapse: ['web-player.your-library-x.collapse-your-library', 'Collapse Your Library'],
  expand: ['web-player.your-library-x.expand-your-library-fullscreen', 'Expand Your Library'],
} as const;

function localized([key, fallback]: readonly [string, string]): string {
  let text: unknown;
  try {
    text = (window as unknown as { Spicetify?: { Locale?: { get(k: string): string } } })
      .Spicetify?.Locale?.get(key);
  } catch { text = null; }
  return typeof text === 'string' && text && text !== key ? text : fallback;
}

/** Spotify labels these controls; nothing else in the chrome shares the label. */
function findByLabel(label: string): HTMLElement | null {
  const escaped = label.replace(/["\\]/g, '\\$&');
  return document.querySelector<HTMLElement>(`button[aria-label="${escaped}"]`);
}

export interface ChromeState {
  collapsedLeft: boolean;
}

export function collapseChrome(): ChromeState {
  document.body.classList.add(BODY_CLASS);
  const state: ChromeState = { collapsedLeft: false };

  // A collapse-labelled button only exists while the sidebar is expanded, so
  // its presence is the test for "needs collapsing" -- and its absence means
  // the user already had it collapsed and we must not expand it on the way out.
  const collapse = findByLabel(localized(LABELS.collapse));
  if (collapse) {
    collapse.click();
    state.collapsedLeft = true;
  }

  // The now-playing panel is left to the stylesheet: the body class hides it
  // and zeroes the width the root grid reserves for it, which needs no undo --
  // dropping the class brings it back exactly as it was. Clicking its hide
  // button would change client state we would then have to guess how to
  // restore.
  return state;
}

/**
 * Makes the nav entry a toggle. Spicetify wires that button to push the route
 * and nothing else, so a second click on it while already here is a no-op --
 * it looks broken. A capture listener on the button gets the click before
 * React's root container sees it, so stopping propagation there keeps
 * spicetify's own handler from running and leaves us free to go back instead.
 *
 * Returns a teardown, or null when the nav entry is not in the DOM yet -- on a
 * cold start spicetify renders it a moment after the route mounts, so the
 * caller retries. The listener must not outlive the route, or the nav entry
 * would stop working from anywhere else.
 */
export function makeNavToggle(onToggle: () => void): (() => void) | null {
  const button = document.querySelector<HTMLElement>('button[aria-label="Library Manager"]');
  if (!button) return null;
  const handler = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  };
  button.addEventListener('click', handler, true);
  return () => button.removeEventListener('click', handler, true);
}

export function restoreChrome(state: ChromeState | null): void {
  document.body.classList.remove(BODY_CLASS);
  if (!state) return;
  // Only undo what was actually done. Re-expanding a sidebar the user had
  // collapsed before opening the dashboard would be us changing their setup.
  if (state.collapsedLeft) {
    // The control has to be re-found: the button is re-rendered with the other
    // label when the sidebar collapses, so a reference taken earlier is stale.
    findByLabel(localized(LABELS.expand))?.click();
  }
}
