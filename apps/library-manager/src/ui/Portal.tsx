// Renders into <body>.
//
// Menus, the marquee band and the confirm dialog are all positioned in
// viewport coordinates with position:fixed. That only means "the viewport" as
// long as no ancestor establishes a containing block -- a transform, a filter,
// perspective, will-change or contain on anything between here and the root
// silently redefines what fixed is fixed to, and Spotify's main view is full
// of scroll containers that do exactly that. The symptom is a context menu
// that opens somewhere other than the pointer.
//
// Going through the body sidesteps the question entirely, and takes the
// elements out of any ancestor's overflow clipping at the same time.

const { createPortal } = Spicetify.ReactDOM;

export function Portal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body);
}
