// Iceni -- UI customizations that need behavior rather than CSS.
//
//   1. Hides the player bar's "Connect to a device" button but keeps the
//      feature, adding it to the profile menu through Spicetify's own menu API.
//   2. Adds a Recents button next to Queue. Both drive the same right-hand
//      panel: Queue selects its Queue tab, Recents selects Recently played, so
//      the two are mutually exclusive by construction.
//   3. Injects a close button into the Spicy Popup Lyrics (Document
//      Picture-in-Picture) window, which otherwise has no in-window control.
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

  const status = { recentsButton: false, menuItem: false, pipHooked: false, pipMounts: 0 };
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

  function decorateMenu(menu) {
    const list = menu.querySelector('ul');
    if (!list) return;

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

  new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType !== 1) continue;
        const menu = node.id === 'context-menu' ? node : node.querySelector?.('#context-menu');
        if (menu) { try { decorateMenu(menu); } catch (e) { console.error('[Iceni] menu', e); } }
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
