// Where a press has to land for a floating panel to close.
//
// Its own module, with no reference to Spicetify, so it can be tested under
// Node. ContextMenu.tsx destructures Spicetify.ReactDOM at module scope, and
// anything importing it outside the client dies on that line -- the same trap
// the formatters were pulled out of.

/**
 * Whether a press at this target should dismiss the menu.
 *
 * This used to be unconditional, and it meant no menu item ever ran. The
 * dismissal listens on mousedown in the capture phase, so pressing an item
 * closed the menu before the press became a click: the button was already
 * unmounted, and the click never reached it. Every entry in both menus -- add
 * to playlist, remove, like, unlike, delete -- behaved like a dead control.
 */
export function shouldDismiss(target: { closest(sel: string): unknown } | null): boolean {
  return !target?.closest('.lm-menu');
}
