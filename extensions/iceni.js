// Iceni -- UI customizations that need behavior rather than CSS.
//
//   1. Hides the player bar's "Connect to a device" button but keeps the
//      feature, by re-triggering that button from the profile menu.
//   2. Adds a Recents button to the player bar that opens /recents.
//   3. Prunes "Support" and "Spicy Lyrics Settings" from the profile menu and
//      adds the device picker entry.
//   4. Injects a close button into the Spicy Popup Lyrics (Document
//      Picture-in-Picture) window, which otherwise has no in-window control.
//
// Selectors were read off the running client with a DOM probe. Where a stable
// data-testid exists it is preferred; the device picker button has none, so it
// is found structurally and tagged.

(function iceni() {
  const NAV = '.main-globalNav-contentRight';
  const CONTROLS = '.main-nowPlayingBar-extraControls';

  if (!(window.Spicetify?.Platform?.History && document.querySelector(CONTROLS))) {
    return setTimeout(iceni, 400);
  }

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

  // ── 2. Recents button in the player bar ──────────────────────────────
  function addRecentsButton() {
    const strip = document.querySelector(CONTROLS);
    if (!strip || document.getElementById('iceni-recents-button')) return;

    // Borrow the class list of a sibling so it matches Spotify's own buttons
    // exactly, including hover and focus treatment.
    const sibling = strip.querySelector('button[data-testid="pip-toggle-button"]')
      || strip.querySelector('button[data-testid]');
    const btn = document.createElement('button');
    btn.id = 'iceni-recents-button';
    btn.className = sibling ? sibling.className : '';
    btn.setAttribute('aria-label', 'Recents');
    btn.setAttribute('type', 'button');
    btn.innerHTML = ICONS.recents;
    btn.addEventListener('click', () => {
      Spicetify.Platform.History.push('/recents');
    });

    const queue = strip.querySelector('[data-testid="control-button-queue"]');
    const anchor = queue?.parentElement?.parentElement === strip
      ? queue.parentElement
      : queue;
    if (anchor && anchor.parentElement === strip) {
      strip.insertBefore(btn, anchor);
    } else {
      strip.insertBefore(btn, strip.firstChild);
    }
  }

  // ── 3. Profile menu ──────────────────────────────────────────────────
  const MENU_SELECTOR = '#context-menu, [role="menu"], .main-contextMenu-menu';

  function itemText(li) {
    return (li.textContent || '').trim().toLowerCase();
  }

  function pruneAndExtendMenu(menu) {
    if (menu.dataset.iceniDone === '1') return;

    const items = [...menu.querySelectorAll('li')];
    // Only treat this as the profile menu if it carries entries unique to it.
    const isProfileMenu = items.some((li) =>
      /log out|private session|account/.test(itemText(li)));
    if (!isProfileMenu) return;
    menu.dataset.iceniDone = '1';

    for (const li of items) {
      const t = itemText(li);
      const href = li.querySelector('a')?.getAttribute('href') || '';
      const isSupport = t === 'support' || /support\.spotify\.com/.test(href);
      const isSpicySettings = t === 'spicy lyrics settings';
      if (isSupport || isSpicySettings) li.remove();
    }

    // Device picker entry, replacing the hidden player-bar button.
    const connect = findConnectButton();
    if (!connect) return;

    const template = menu.querySelector('li');
    if (!template) return;
    const li = template.cloneNode(true);
    li.removeAttribute('data-iceni-done');

    // Reuse the cloned row's own button/anchor so styling matches, but strip
    // any React handlers by replacing the node with a clean copy.
    const oldControl = li.querySelector('button, a');
    if (!oldControl) return;
    const control = document.createElement('button');
    control.className = oldControl.className;
    control.setAttribute('type', 'button');
    const label = oldControl.querySelector('span') || oldControl;
    control.innerHTML = oldControl.innerHTML;
    const textNode = control.querySelector('span') || control;
    textNode.textContent = 'Connect to a device';
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
  }

  new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType !== 1) continue;
        const menu = node.matches?.(MENU_SELECTOR)
          ? node
          : node.querySelector?.(MENU_SELECTOR);
        if (menu) { try { pruneAndExtendMenu(menu); } catch (e) { console.error('[Iceni] menu', e); } }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ── 4. Close button inside the Spicy Popup Lyrics PiP window ─────────
  function attachPipCloseButton(pipWindow) {
    if (!pipWindow?.document || pipWindow.document.getElementById('iceni-pip-close')) return;
    const doc = pipWindow.document;
    const btn = doc.createElement('button');
    btn.id = 'iceni-pip-close';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Close lyrics');
    btn.innerHTML = ICONS.close;
    btn.addEventListener('click', () => pipWindow.close());

    const mount = () => {
      if (!doc.body) return setTimeout(mount, 60);
      doc.body.appendChild(btn);
    };
    mount();
  }

  if ('documentPictureInPicture' in window) {
    try {
      window.documentPictureInPicture.addEventListener('enter', (event) => {
        attachPipCloseButton(event.window || window.documentPictureInPicture.window);
      });
      // If a PiP window is already open when this loads.
      if (window.documentPictureInPicture.window) {
        attachPipCloseButton(window.documentPictureInPicture.window);
      }
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
    new MutationObserver(() => apply())
      .observe(strip.parentElement, { childList: true, subtree: true });
  }

  console.log('[Iceni] customizations loaded');
})();
