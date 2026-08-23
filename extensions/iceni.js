// Iceni -- UI customizations that need behavior rather than CSS.
//
//   1. Hides the player bar's "Connect to a device" button but keeps the
//      feature, adding it to the profile menu through Spicetify's own menu API.
//   2. Adds a Recents button next to Queue. Both drive the same right-hand
//      panel: Queue selects its Queue tab, Recents selects Recently played, so
//      the two are mutually exclusive by construction.
//   3. Injects a close button into the Spicy Popup Lyrics (Document
//      Picture-in-Picture) window, which otherwise has no in-window control.
//   4. Tags the context menu's library toggles with the state they are in, so
//      user.css can draw a different glyph for "save" and for "remove". These
//      are the only toggles in the client that ship the same icon for both.
//
// Nothing here removes a node that React owns. The profile menu is React
// rendered, and deleting its children makes the next reconciliation fail and
// the menu stops opening; rows we do not want are hidden from user.css
// instead. Selectors were read off the running client with a DOM probe.

(function iceni() {
  const CONTROLS = '.main-nowPlayingBar-extraControls';
  const RECENTS_ID = 'iceni-recents-button';
  const QUEUE_SELECTOR = '[data-testid="control-button-queue"]';
  const HISTORY_TAB = 'history-tab';
  const QUEUE_TAB = 'queue-tab';

  if (!(window.Spicetify?.Platform?.History && document.querySelector(CONTROLS))) {
    return setTimeout(iceni, 400);
  }

  const status = {
    recentsButton: false, menuItem: false, pipHooked: false, pipMounts: 0, libraryRows: 0,
  };
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

  const tab = (id) => document.getElementById(id);
  const panelOpen = () => !!tab(QUEUE_TAB) || !!tab(HISTORY_TAB);
  const historyLive = () => tab(HISTORY_TAB)?.getAttribute('aria-selected') === 'true';

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

  // ── Profile menu ─────────────────────────────────────────────────────
  // Rows we do not want are hidden, never removed: this menu is React
  // rendered, and deleting nodes it owns makes the next reconciliation fail
  // so the menu stops opening. Most rows are hidden from user.css; the ones
  // only identifiable by their label are tagged here for the same CSS to
  // catch. The device picker row is appended -- adding a node React does not
  // know about is safe, and it is re-added every time the menu opens.
  //
  // Spicetify.Menu.Item would be the supported path, but constructing one
  // without a leadingIcon throws ("reading 'jsx'"), so this stays DOM level.
  const HIDE_LABELS = ['spicy lyrics settings'];

  // Desired profile menu order. Rows are placed with the CSS order property
  // rather than by moving nodes, since this list is React rendered. href is
  // used where one exists; the rest fall back to their label, which ties those
  // few to an English UI.
  const ROW_ORDER = [
    { order: 1, test: (t, href) => t === 'account' || /accounts?\.spotify\.com/.test(href) },
    { order: 2, test: (t, href) => t === 'profile' || href.startsWith('/user/') },
    { order: 3, test: (t) => t === 'private session' },
    { order: 4, test: (t, href, li) => li.classList.contains('iceni-device-row') },
    { order: 5, test: (t, href) => href === '/preferences' || t === 'settings' },
    { order: 6, test: (t) => t === 'log out' },
  ];

  function orderRows(list) {
    for (const li of list.querySelectorAll(':scope > li')) {
      const label = (li.textContent || '').trim().toLowerCase();
      const href = li.querySelector('a')?.getAttribute('href') || '';
      const hit = ROW_ORDER.find((r) => {
        try { return r.test(label, href, li); } catch (_) { return false; }
      });
      if (hit) li.style.order = String(hit.order);
    }
  }

  // Only the profile menu. Spotify reuses #context-menu for every context
  // menu, so without this the device row was appended to the track menu too.
  function isProfileMenu(list) {
    return [...list.querySelectorAll(':scope > li')].some((li) =>
      /log out|private session/.test((li.textContent || '').trim().toLowerCase()));
  }

  function decorateMenu(menu) {
    const list = menu.querySelector('ul');
    // #context-menu is reused for every context menu, so the marker has to be
    // cleared as well as set -- otherwise profile-only styling would leak into
    // whichever menu opened next. It collapsed the Add to playlist list into a
    // single row once already.
    if (!list || !isProfileMenu(list)) {
      menu.classList.remove('iceni-profile-menu');
      return;
    }
    menu.classList.add('iceni-profile-menu');

    for (const li of list.querySelectorAll(':scope > li')) {
      const label = (li.textContent || '').trim().toLowerCase();
      if (HIDE_LABELS.includes(label)) li.classList.add('iceni-hidden-row');
    }
    orderRows(list);

    if (!findConnectButton()) return;
    if (list.querySelector(':scope > li.iceni-device-row')) return;

    // Clone a visible row with no icon so the new entry inherits the native
    // styling without Spicetify's decorative flask.
    const template = [...list.querySelectorAll(':scope > li')].find((li) =>
      li.querySelector('button')
      && !li.querySelector('svg')
      && !li.querySelector('img')
      && !li.classList.contains('iceni-hidden-row')
      && getComputedStyle(li).display !== 'none');
    if (!template) return;

    const li = template.cloneNode(true);
    li.classList.add('iceni-device-row');
    const oldControl = li.querySelector('button');
    if (!oldControl) return;

    // Replace the control with a clean copy so no React handler comes along.
    const control = document.createElement('button');
    for (const { name, value } of oldControl.attributes) control.setAttribute(name, value);
    control.innerHTML = oldControl.innerHTML;
    (control.querySelector('span') || control).textContent = 'Connect to a device';
    oldControl.replaceWith(control);

    control.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      findConnectButton()?.click();
    });

    list.appendChild(li);
    orderRows(list);
    status.menuItem = true;
  }

  // ── Library toggles: make the two states look different ──────────────
  // "Save to your Liked Songs" and "Save to Your Episodes" are rendered with
  // a persistentIcon -- a thumbnail of the collection's cover art -- and
  // Spotify passes the same one whether the item is saved or not, so the row
  // is identical in both states. Every other library toggle in the client
  // swaps a plus for a check. user.css draws these two rows from a mask
  // instead; this decides which mask, by tagging the row.
  //
  // The state is only legible from the label, so the labels are read back out
  // of Spotify's own dictionary rather than hardcoded, and the row keeps
  // working in whatever language the client is in. The English strings are
  // there for the case where the key is missing and Locale.get echoes the key
  // back. Nothing is tagged when neither matches, and user.css falls back to
  // the solid glyph it used before -- the old behaviour, not a blank slot.
  const LIBRARY_ROWS = [
    {
      cover: 'liked-songs',
      add: ['save_to_your_liked_songs', 'Save to your Liked Songs'],
      remove: ['remove_from_your_liked_songs', 'Remove from your Liked Songs'],
    },
    {
      cover: 'your-episodes',
      add: ['contextmenu.save-to-your-episodes', 'Save to Your Episodes'],
      remove: ['contextmenu.remove-from-your-episodes', 'Remove from Your Episodes'],
    },
  ];

  function localized([key, fallback]) {
    let text;
    try { text = window.Spicetify?.Locale?.get(key); } catch (_) { text = null; }
    if (typeof text !== 'string' || !text || text === key) text = fallback;
    return text.trim().toLowerCase();
  }

  function tagLibraryRows(menu) {
    let tagged = 0;
    for (const row of LIBRARY_ROWS) {
      const covers = menu.querySelectorAll(`li img[src*="${row.cover}"]`);
      if (!covers.length) continue;
      const add = localized(row.add);
      const remove = localized(row.remove);
      for (const cover of covers) {
        const li = cover.closest('li');
        if (!li) continue;
        // The row's trailing slot can carry a keyboard shortcut, so this
        // matches on the leading label rather than the whole row. Where one
        // label is a prefix of the other -- which happens in some languages --
        // the longer match wins.
        const text = (li.textContent || '').trim().toLowerCase();
        const isAdd = text.startsWith(add);
        const isRemove = text.startsWith(remove);
        const saved = isRemove && (!isAdd || remove.length > add.length);
        li.classList.toggle('iceni-library-add', isAdd && !saved);
        if (isAdd || isRemove) tagged += 1;
      }
    }
    status.libraryRows = tagged;
  }

  // The label flips from "Save" to "Remove" once the library lookup resolves,
  // which is after the menu has been painted, so one pass at open time is not
  // enough. Attribute changes are deliberately not observed: tagging sets a
  // class, and observing them would feed the observer its own writes.
  function watchLibraryRows(menu) {
    tagLibraryRows(menu);
    const observer = new MutationObserver(() => {
      if (!menu.isConnected) return observer.disconnect();
      tagLibraryRows(menu);
    });
    observer.observe(menu, { childList: true, subtree: true, characterData: true });
  }

  new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType !== 1) continue;
        const menu = node.id === 'context-menu' ? node : node.querySelector?.('#context-menu');
        if (!menu) continue;
        try { decorateMenu(menu); } catch (e) { console.error('[Iceni] menu', e); }
        try { watchLibraryRows(menu); } catch (e) { console.error('[Iceni] library rows', e); }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ── 2. Recents button, wired to the Queue panel's Recently played tab ──
  function syncState() {
    const btn = document.getElementById(RECENTS_ID);
    const onHistory = panelOpen() && historyLive();
    document.body.classList.toggle('iceni-panel-history', onHistory);
    if (!btn) return;
    btn.setAttribute('data-active', onHistory ? 'true' : 'false');
    btn.setAttribute('aria-pressed', onHistory ? 'true' : 'false');
  }

  // Set while we deliberately drive the Queue button ourselves, so the
  // interceptor below does not turn our own close into a tab switch.
  let drivingQueueButton = false;

  function openRecents() {
    if (panelOpen()) {
      if (historyLive()) {
        // Toggle off: close the panel the same way Spotify does.
        drivingQueueButton = true;
        document.querySelector(QUEUE_SELECTOR)?.click();
        setTimeout(() => { drivingQueueButton = false; }, 250);
      } else {
        tab(HISTORY_TAB)?.click();
      }
      setTimeout(syncState, 120);
      return;
    }
    // Panel closed. Spotify always opens it on the Queue tab, so switch as
    // soon as the tabs are live and keep the panel hidden until then, so the
    // wrong tab is never on screen. Clicking the tab the instant it mounts is
    // too early -- React has not attached its handler yet and the click is
    // swallowed -- so retry on a short interval until the selection sticks.
    document.body.classList.add('iceni-switching');
    let settled = false;
    // Never leave the panel hidden for long enough to notice, whatever
    // happens to the tab we are waiting on.
    const hardStop = setTimeout(() => finish(), 300);
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(hardStop);
      document.body.classList.remove('iceni-switching');
      syncState();
    }
    const selectHistory = (attempt = 0) => {
      if (settled) return;
      const t = tab(HISTORY_TAB);
      if (t?.getAttribute('aria-selected') === 'true') return finish();
      if (attempt > 40) return finish();
      if (t) t.click();
      setTimeout(() => selectHistory(attempt + 1), 16);
    };
    selectHistory();

    drivingQueueButton = true;
    document.querySelector(QUEUE_SELECTOR)?.click();
    setTimeout(() => { drivingQueueButton = false; }, 250);
  }

  function addRecentsButton() {
    const strip = document.querySelector(CONTROLS);
    if (!strip) return;
    if (document.getElementById(RECENTS_ID)) { syncState(); return; }

    const sibling = strip.querySelector('button[data-testid="pip-toggle-button"]')
      || strip.querySelector('button[data-testid]');
    const btn = document.createElement('button');
    btn.id = RECENTS_ID;
    btn.className = sibling ? sibling.className : '';
    btn.setAttribute('aria-label', 'Recently played');
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-encore-id', 'buttonTertiary');
    btn.innerHTML = '<span aria-hidden="true" class="e-10451-button__icon-wrapper">'
      + ICONS.recents + '</span>';
    btn.addEventListener('click', openRecents);

    if (typeof Spicetify.Tippy === 'function') {
      try {
        Spicetify.Tippy(btn, { ...(Spicetify.TippyProps || {}), content: 'Recently played' });
      } catch (_) { btn.title = 'Recently played'; }
    } else {
      btn.title = 'Recently played';
    }

    // Queue on the left, Recents on the right: insert after the queue control.
    const queue = strip.querySelector(QUEUE_SELECTOR);
    const queueSlot = queue?.parentElement?.parentElement === strip
      ? queue.parentElement
      : queue;
    if (queueSlot && queueSlot.parentElement === strip) queueSlot.after(btn);
    else strip.appendChild(btn);

    status.recentsButton = true;
    syncState();
  }

  // Queue and Recents drive the same panel. Spotify's Queue button toggles the
  // panel shut, so pressing it while Recently played is showing would close
  // everything instead of switching. Intercept that one case.
  document.addEventListener('click', (e) => {
    const q = e.target?.closest?.(QUEUE_SELECTOR);
    if (!q || drivingQueueButton) return;
    if (panelOpen() && historyLive()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      tab(QUEUE_TAB)?.click();
      setTimeout(syncState, 120);
    }
  }, true);

  // The tabs live inside the panel, which mounts and unmounts, so watch for it.
  new MutationObserver(() => syncState())
    .observe(document.body, { childList: true, subtree: true, attributes: true,
                              attributeFilter: ['aria-selected'] });

  // ── Playlist / album header banner ───────────────────────────────────
  // Publish the cover art URL so user.css can paint it behind the header.
  // Only the URL comes from here; the styling is all CSS.
  function applyHeaderBanner() {
    const container = document.querySelector('.main-entityHeader-container');
    if (!container) return;
    const img = container.querySelector('img.main-entityHeader-image');
    const src = img?.currentSrc || img?.src;
    if (!src) {
      container.style.removeProperty('--iceni-banner');
      return;
    }
    const next = 'url("' + src + '")';
    // Compare before writing: this runs from a DOM observer, and writing
    // unconditionally would keep waking it up.
    if (container.style.getPropertyValue('--iceni-banner') !== next) {
      container.style.setProperty('--iceni-banner', next);
    }
  }

  new MutationObserver(() => {
    try { applyHeaderBanner(); } catch (e) { console.error('[Iceni] banner', e); }
  }).observe(document.body, { childList: true, subtree: true });
  Spicetify.Platform.History.listen(() => setTimeout(applyHeaderBanner, 60));
  applyHeaderBanner();

  // ── Now Playing View sections ────────────────────────────────────────
  // Two of these have stable class names and are handled in user.css; the
  // other two only have hashed ones, so they are matched on their header text.
  const NPV_HIDE = ['related music videos', 'about the artist', 'credits', 'on tour'];

  function pruneNowPlayingView() {
    for (const section of document.querySelectorAll('.main-nowPlayingView-section')) {
      const header = section.querySelector('.main-nowPlayingView-sectionHeaderText');
      const label = (header?.textContent || '').trim().toLowerCase();
      if (NPV_HIDE.includes(label)) section.classList.add('iceni-hidden-section');
    }
  }

  new MutationObserver(() => {
    try { pruneNowPlayingView(); } catch (e) { console.error('[Iceni] npv', e); }
  }).observe(document.body, { childList: true, subtree: true });
  pruneNowPlayingView();

  // ── 3. Close button inside the Spicy Popup Lyrics PiP window ─────────
  // The PiP document starts empty and carries no stylesheets, and Spicy Lyrics
  // then overwrites body.innerHTML wholesale -- which wipes anything appended
  // on the "enter" event. So the styles are injected into that document
  // directly and the button is re-added whenever the body is rebuilt.
  const PIP_CSS = `
    #iceni-pip-close {
      position: fixed; top: 10px; right: 10px; z-index: 2147483647;
      width: 30px; height: 30px; display: flex; align-items: center;
      justify-content: center; padding: 0; border: none; border-radius: 999px;
      cursor: pointer; color: rgba(255,255,255,0.85);
      /* The button sits over .app-drag-region, which is a window drag handle.
         Without opting out, the area under it drags the window instead of
         taking the click. */
      -webkit-app-region: no-drag;
      background: rgba(0,0,0,0.45);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14);
      -webkit-backdrop-filter: blur(12px) saturate(1.4);
      backdrop-filter: blur(12px) saturate(1.4);
      transition: background .18s ease, color .18s ease;
    }
    #iceni-pip-close svg { width: 15px; height: 15px; fill: currentColor; }
    #iceni-pip-close:hover { background: rgba(0,0,0,0.72); color: #fff; }

    /* Same artwork-backdrop fix as in user.css. It is repeated here because
       the popup is a separate document and we do not want to depend on which
       of Spotify's stylesheets Spicy Lyrics chooses to copy into it. */
    #SpicyLyricsPage .spicy-dynamic-bg.StaticBackground.transition_In,
    #SpicyLyricsPage .spicy-dynamic-bg.StaticBackground.transition_Out {
      animation: none !important;
      transform: none !important;
    }
  `;

  // Closing the popup must go through Spicy Lyrics' own toggle, not
  // pipWindow.close(). It registers a "pagehide" handler on that window which
  // calls window.location.reload(), and its ClosePopupLyrics() detaches that
  // handler (and tears down its fullscreen/page state) before closing. Calling
  // close() directly skips all of it, so the popup would take Spotify down for
  // a full reload every time it was dismissed.
  function closePopupLyrics(pipWindow) {
    const toggle = document.getElementById('SpicyLyrics_PopupLyricsButton');
    if (toggle) { toggle.click(); return; }
    // No toggle to drive: close directly and accept the reload rather than
    // leaving the window stuck open.
    console.warn('[Iceni] Spicy popup toggle not found; closing directly');
    pipWindow.close();
  }

  function ensurePipButton(pipWindow) {
    const doc = pipWindow?.document;
    if (!doc?.body) return;
    if (!doc.getElementById('iceni-pip-style')) {
      const style = doc.createElement('style');
      style.id = 'iceni-pip-style';
      style.textContent = PIP_CSS;
      (doc.head || doc.documentElement).appendChild(style);
    }
    if (doc.getElementById('iceni-pip-close')) return;
    const btn = doc.createElement('button');
    btn.id = 'iceni-pip-close';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Close lyrics');
    btn.title = 'Close lyrics';
    btn.innerHTML = ICONS.close;
    btn.addEventListener('click', () => closePopupLyrics(pipWindow));
    doc.body.appendChild(btn);
    status.pipMounts += 1;
  }

  function hookPip(pipWindow) {
    if (!pipWindow) return;
    const doc = pipWindow.document;
    const tryMount = (n = 0) => {
      if (!doc.body) { if (n < 60) setTimeout(() => tryMount(n + 1), 50); return; }
      ensurePipButton(pipWindow);
      // Spicy Lyrics replaces body.innerHTML after the window opens, so keep
      // putting the button back for as long as the window lives.
      new MutationObserver(() => ensurePipButton(pipWindow))
        .observe(doc.body, { childList: true });
    };
    tryMount();
  }

  if ('documentPictureInPicture' in window) {
    try {
      window.documentPictureInPicture.addEventListener('enter', (event) => {
        hookPip(event.window || window.documentPictureInPicture.window);
      });
      if (window.documentPictureInPicture.window) {
        hookPip(window.documentPictureInPicture.window);
      }
      status.pipHooked = true;
    } catch (e) {
      console.error('[Iceni] pip', e);
    }
  }

  // ── Bootstrapping and re-application ─────────────────────────────────
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
