// Iceni -- UI customizations that need behavior rather than CSS.
//
//   1. Hides the player bar's "Connect to a device" button but keeps the
//      feature, by re-triggering that button from the profile menu.
//   2. Adds a Recents button to the player bar: tooltip on hover, active state
//      while /recents is open, and clicking it again navigates back.
//   3. Prunes the profile menu (Support, Spicy Lyrics Settings, Recents, the
//      "Your Updates" notification block, and the decorative icons Spicetify
//      adds to its own rows) and inserts the device picker entry.
//   4. Injects a close button into the Spicy Popup Lyrics (Document
//      Picture-in-Picture) window, which otherwise has no in-window control.
//
// Selectors were read off the running client with a DOM probe. Where a stable
// data-testid exists it is preferred; the device picker button has none, so it
// is found structurally and tagged.

(function iceni() {
  const CONTROLS = '.main-nowPlayingBar-extraControls';
  const RECENTS_PATH = '/recents';
  const RECENTS_ID = 'iceni-recents-button';

  if (!(window.Spicetify?.Platform?.History && document.querySelector(CONTROLS))) {
    return setTimeout(iceni, 400);
  }

  const History = Spicetify.Platform.History;
  const status = { recentsButton: false, menuProcessed: 0, pipHooked: false };
  window.__iceni = status;

  const ICONS = {
    // Clock with a counter-clockwise arrow -- the conventional "recent" glyph.
    recents:
      '<svg viewBox="0 0 16 16" aria-hidden="true">' +
      '<path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5.75.75 0 0 1 1.5 0A8 8 0 1 1 8 0a7.97 7.97 0 0 1 5.5 2.19V.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1 0-1.5h1.86A6.47 6.47 0 0 0 8 1.5z"/>' +
      '<path d="M8.75 4.25a.75.75 0 0 0-1.5 0V8c0 .27.14.52.37.65l2.75 1.6a.75.75 0 0 0 .76-1.3L8.75 7.57V4.25z"/>' +
      '</svg>',
    close:
      '<svg viewBox="0 0 16 16" aria-hidden="true">' +
      '<path d="M2.47 2.47a.75.75 0 0 1 1.06 0L8 6.94l4.47-4.47a.75.75 0 1 1 1.06 1.06L9.06 8l4.47 4.47a.75.75 0 1 1-1.06 1.06L8 9.06l-4.47 4.47a.75.75 0 0 1-1.06-1.06L6.94 8 2.47 3.53a.75.75 0 0 1 0-1.06z"/>' +
      '</svg>',
  };

  const currentPath = () => History.location?.pathname || '';
  const onRecents = () => currentPath().startsWith(RECENTS_PATH);

  // ── 1. Device picker: locate and tag, so CSS can hide it ─────────────
  // It is the only direct <span> child of the control strip wrapping a button
  // with no data-testid. Structural rather than aria-label based, so it does
  // not break when Spotify's language changes.
  function findConnectButton() {
    const strip = document.querySelector(CONTROLS);
    if (!strip) return null;
    for (const child of strip.children) {
      if (child.tagName !== 'SPAN') continue;
      const btn = child.querySelector(':scope > button:not([data-testid])');
      if (btn) {
        child.classList.add('iceni-connect-host');
        return btn;
      }
    }
    return null;
  }

  // ── 2. Recents button ────────────────────────────────────────────────
  function syncRecentsState(btn) {
    const active = onRecents();
    btn.setAttribute('data-active', active ? 'true' : 'false');
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  function addRecentsButton() {
    const strip = document.querySelector(CONTROLS);
    if (!strip) return;
    const existing = document.getElementById(RECENTS_ID);
    if (existing) { syncRecentsState(existing); return; }

    // Borrow the class list of a sibling so it matches Spotify's own buttons
    // exactly, including hover and focus treatment.
    const sibling = strip.querySelector('button[data-testid="pip-toggle-button"]')
      || strip.querySelector('button[data-testid]');
    const btn = document.createElement('button');
    btn.id = RECENTS_ID;
    btn.className = sibling ? sibling.className : '';
    btn.setAttribute('aria-label', 'Recents');
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-encore-id', 'buttonTertiary');
    btn.innerHTML = '<span aria-hidden="true" class="e-10451-button__icon-wrapper">'
      + ICONS.recents + '</span>';
    syncRecentsState(btn);

    btn.addEventListener('click', () => {
      if (onRecents()) {
        // Toggle off: return to wherever we came from, mirroring how Spotify's
        // own panel buttons behave. Fall back to home if there is no history.
        if (typeof History.goBack === 'function' && History.length > 1) History.goBack();
        else History.push('/');
      } else {
        History.push(RECENTS_PATH);
      }
    });

    // Hover tooltip, using Spotify's own tooltip engine when Spicetify
    // exposes it so it matches every other control in the bar.
    if (typeof Spicetify.Tippy === 'function') {
      try {
        Spicetify.Tippy(btn, { ...(Spicetify.TippyProps || {}), content: 'Recents' });
      } catch (_) {
        btn.title = 'Recents';
      }
    } else {
      btn.title = 'Recents';
    }

    const queue = strip.querySelector('[data-testid="control-button-queue"]');
    const anchor = queue?.parentElement?.parentElement === strip
      ? queue.parentElement
      : queue;
    if (anchor && anchor.parentElement === strip) strip.insertBefore(btn, anchor);
    else strip.insertBefore(btn, strip.firstChild);

    status.recentsButton = true;
  }

  History.listen(() => {
    const btn = document.getElementById(RECENTS_ID);
    if (btn) syncRecentsState(btn);
  });

  // ── 3. Profile menu ──────────────────────────────────────────────────
  const MENU_SELECTOR = '#context-menu, [role="menu"], .main-contextMenu-menu';
  const itemText = (el) => (el.textContent || '').trim().toLowerCase();

  function pruneAndExtendMenu(menu) {
    if (menu.dataset.iceniDone === '1') return;
    const items = [...menu.querySelectorAll('li')];
    // Only treat this as the profile menu if it carries entries unique to it.
    if (!items.some((li) => /log out|private session|account/.test(itemText(li)))) return;
    menu.dataset.iceniDone = '1';

    // Rows we do not want. Recents goes because the player bar now has a
    // button for it; Spicy Lyrics settings are reachable from the lyrics page.
    for (const li of items) {
      const t = itemText(li);
      const href = li.querySelector('a')?.getAttribute('href') || '';
      if (t === 'support' || /support\.spotify\.com/.test(href)
        || t === 'spicy lyrics settings'
        || t === 'recents' || href === '/recents') {
        li.remove();
      }
    }

    // The "Your Updates" block: a section holding encore listRow notifications.
    // Matched structurally rather than by its label so it survives a language
    // change, along with the divider that introduces it.
    for (const section of [...menu.children]) {
      if (section.tagName === 'LI') continue;
      if (!section.querySelector?.('[data-encore-id="listRow"]')) continue;
      const prev = section.previousElementSibling;
      if (prev?.classList?.contains('main-contextMenu-dividerAfter')) prev.remove();
      section.remove();
    }

    // Spicetify decorates its own injected rows with a flask icon. Native rows
    // either have no icon or an "External link" glyph (aria-hidden="false"),
    // so removing only the decorative ones leaves Spotify's own rows intact.
    for (const svg of menu.querySelectorAll('li svg[data-encore-id="icon"][aria-hidden="true"]')) {
      svg.closest('span, div')?.style.setProperty('display', 'none', 'important');
      svg.remove();
    }

    // Device picker entry, replacing the hidden player-bar button.
    if (!findConnectButton()) return;

    // Clone a row that has no icon, so the new entry does not inherit one.
    const template = [...menu.querySelectorAll('li.main-contextMenu-menuItem')]
      .find((li) => li.querySelector('button') && !li.querySelector('svg'));
    if (!template) return;

    const li = template.cloneNode(true);
    const oldControl = li.querySelector('button');
    if (!oldControl) return;

    // Replace the control with a clean copy so no React handler comes along.
    const control = document.createElement('button');
    for (const { name, value } of oldControl.attributes) control.setAttribute(name, value);
    control.innerHTML = oldControl.innerHTML;
    const labelNode = control.querySelector('span') || control;
    labelNode.textContent = 'Connect to a device';
    oldControl.replaceWith(control);

    control.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Close the menu first, then trigger the real (hidden) button so
      // Spotify's own device picker opens with all its behavior intact.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      setTimeout(() => findConnectButton()?.click(), 60);
    });

    const anchorItem = [...menu.querySelectorAll('li')]
      .find((x) => /private session/.test(itemText(x)));
    if (anchorItem) anchorItem.before(li);
    else menu.appendChild(li);

    status.menuProcessed += 1;
  }

  new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType !== 1) continue;
        const menu = node.matches?.(MENU_SELECTOR) ? node : node.querySelector?.(MENU_SELECTOR);
        if (menu) {
          try { pruneAndExtendMenu(menu); } catch (e) { console.error('[Iceni] menu', e); }
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ── 4. Close button inside the Spicy Popup Lyrics PiP window ─────────
  function attachPipCloseButton(pipWindow) {
    if (!pipWindow?.document) return;
    const doc = pipWindow.document;
    const mount = () => {
      if (!doc.body) return setTimeout(mount, 60);
      if (doc.getElementById('iceni-pip-close')) return;
      const btn = doc.createElement('button');
      btn.id = 'iceni-pip-close';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Close lyrics');
      btn.title = 'Close lyrics';
      btn.innerHTML = ICONS.close;
      btn.addEventListener('click', () => pipWindow.close());
      doc.body.appendChild(btn);
    };
    mount();
  }

  if ('documentPictureInPicture' in window) {
    try {
      window.documentPictureInPicture.addEventListener('enter', (event) => {
        attachPipCloseButton(event.window || window.documentPictureInPicture.window);
      });
      if (window.documentPictureInPicture.window) {
        attachPipCloseButton(window.documentPictureInPicture.window);
      }
      status.pipHooked = true;
    } catch (e) {
      console.error('[Iceni] pip', e);
    }
  }

  // ── Bootstrapping and re-application ─────────────────────────────────
  // The player bar is re-rendered on some navigations, so re-run the parts
  // that inject into it whenever it changes.
  function apply() {
    try {
      findConnectButton();
      addRecentsButton();
    } catch (e) {
      console.error('[Iceni] apply', e);
    }
  }
  apply();

  const strip = document.querySelector(CONTROLS);
  if (strip?.parentElement) {
    new MutationObserver(() => apply()).observe(strip.parentElement, { childList: true, subtree: true });
  }

  console.log('[Iceni] customizations loaded');
})();
