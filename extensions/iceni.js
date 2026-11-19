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
//   5. Replaces Spicy Lyrics' dead "Update now" action. Its updater assumes
//      the bundle is fetched at runtime; Iceni pins it to disk, so the button
//      reloads into the same version forever. It now shows the command that
//      does update it.
//   6. Gives library folders a picture. Spotify stores no artwork for a
//      rootlist folder, so the image is ours: chosen from the folder's own
//      right-click menu or the settings page, downscaled onto a canvas, kept
//      in localStorage, and painted over the folder glyph in the sidebar.
//   7. Carries Spicy Lyrics through a cold start (see guardColdStart below).
//   8. Keeps Spicy Lyrics' Now Playing visual rules out of the cascade unless
//      the element they style is on screen (see gateSpicyVisualRules below).
//   9. Splits the player bar's single save button into two -- a heart for
//      Liked Songs and a button for playlists -- and gives the second one
//      Iceni's own picker: folders open in place, a tick applies at once.
//
// Nothing here removes a node that React owns. The profile menu is React
// rendered, and deleting its children makes the next reconciliation fail and
// the menu stops opening; rows we do not want are hidden from user.css
// instead. Selectors were read off the running client with a DOM probe.

// ── 7. Spicy Lyrics across a cold start ────────────────────────────────
// Spicetify.Player's getters read Player.origin._state unguarded, and that
// state stays null until Spotify has restored the player, which takes a while
// after a hard restart such as `spicetify apply`. Spicy Lyrics starts inside
// that window: it sees no track and takes its player-bar button down, then
// throws on isPlaying() before it subscribes to song changes -- the one thing
// that would have put the button back. So the getters answer as an idle player
// until the state exists, and once there is a track, one song change is
// replayed for everything that started without one. This runs as the script
// loads, ahead of Spicy Lyrics, rather than inside iceni() below, which waits
// for the player bar.
//
// Spicetify replaces the Spicetify.Player object once Spotify's webpack
// modules have loaded (a copy with an `origin` getter), so nothing here may
// hold on to the object it saw at load: every check reads the live one. The
// guarded functions themselves survive the swap because the copy carries them.
(function guardColdStart() {
  const livePlayer = () => window.Spicetify?.Player;
  const player = livePlayer();
  if (!player || window.__iceniColdStart) return;
  const report = { guarded: [], trackAfterMs: null, replayed: false };
  window.__iceniColdStart = report;

  const idle = {
    isPlaying: false, getProgress: 0, getProgressPercent: 0, getDuration: 0,
    getShuffle: false, getRepeat: 0, getHeart: false,
  };
  for (const [name, answer] of Object.entries(idle)) {
    const original = player[name];
    if (typeof original !== 'function') continue;
    player[name] = function guardedPlayerGetter(...args) {
      return livePlayer()?.origin?._state ? original.apply(this, args) : answer;
    };
    report.guarded.push(name);
  }

  const loadedAt = performance.now();
  (function waitForTrack() {
    const current = livePlayer();
    if (!current?.data?.item) {
      if (performance.now() - loadedAt < 120000) setTimeout(waitForTrack, 200);
      return;
    }
    report.trackAfterMs = Math.round(performance.now() - loadedAt);
    // Let the extensions that started without a player finish starting first.
    setTimeout(() => {
      const target = livePlayer();
      const event = new Event('songchange');
      event.data = target?.data;
      target?.dispatchEvent?.(event);
      report.replayed = true;
    }, 1500);
  })();
})();

(function iceni() {
  // The player bar's right-hand control strip. Spotify 1.3.8 shipped new class
  // hashes before Spicetify's css-map knew them, so the mapped name vanished
  // overnight; the strip is also the only element holding the volume bar as a
  // direct child, which survives a rehash.
  const CONTROLS = '.main-nowPlayingBar-extraControls, div:has(> [data-testid="volume-bar"])';
  const RECENTS_ID = 'iceni-recents-button';
  const QUEUE_SELECTOR = '[data-testid="control-button-queue"]';
  const HISTORY_TAB = 'history-tab';
  const QUEUE_TAB = 'queue-tab';

  if (!(window.Spicetify?.Platform?.History && document.querySelector(CONTROLS))) {
    return setTimeout(iceni, 100);
  }

  const status = {
    recentsButton: false, menuItem: false, pipHooked: false, pipMounts: 0, libraryRows: 0,
    updateHooked: false, updateDialogs: 0, folders: 0, folderArt: 0, folderMenuRows: 0,
    spicyRulesGated: 0, spicyRulesActive: false,
    curationButtons: false, lyricsCuration: false, pickerOpens: 0, pickerWrites: 0,
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

  // Inner markup only. A cloned context-menu row already carries Spotify's own
  // <svg data-encore-id="icon">, and its viewBox, size and fill all come from
  // encore variables on that element, so replacing the paths inside it is what
  // makes the entry sit at exactly the size and colour of the rows around it.
  const GLYPHS = {
    image:
      '<path d="M2.75 1.5h10.5c.69 0 1.25.56 1.25 1.25v10.5c0 .69-.56 1.25-1.25 1.25H2.75c-.69 0-1.25-.56-1.25-1.25V2.75c0-.69.56-1.25 1.25-1.25zM3 3v10h10V3H3z"/>' +
      '<path d="M5.75 4.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5z"/>' +
      '<path d="M4 12h8v-1.19L9.72 8.53a.75.75 0 0 0-1.06 0L7.5 9.69 6.28 8.47a.75.75 0 0 0-1.06 0L4 9.69V12z"/>',
    removeImage:
      '<path d="M2.47 2.47a.75.75 0 0 1 1.06 0L8 6.94l4.47-4.47a.75.75 0 1 1 1.06 1.06L9.06 8l4.47 4.47a.75.75 0 1 1-1.06 1.06L8 9.06l-4.47 4.47a.75.75 0 0 1-1.06-1.06L6.94 8 2.47 3.53a.75.75 0 0 1 0-1.06z"/>',
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
    { order: 6, test: (t) => t === 'slt settings' },
    { order: 7, test: (t) => t === 'log out' },
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
  //
  // Each state lists every wording the client has used: Spotify 1.3.4 moved
  // the menu from "Save to your Liked Songs" to "Add to Liked Songs" and kept
  // both keys in the dictionary, so the older one alone stopped matching.
  const LIBRARY_ROWS = [
    {
      cover: 'liked-songs',
      add: [
        ['web-player.aligned-curation.tooltips.add-to-liked-songs', 'Add to Liked Songs'],
        ['save_to_your_liked_songs', 'Save to your Liked Songs'],
      ],
      remove: [
        ['web-player.aligned-curation.tooltips.remove-from-liked-songs', 'Remove from Liked Songs'],
        ['remove_from_your_liked_songs', 'Remove from your Liked Songs'],
      ],
    },
    {
      cover: 'your-episodes',
      add: [
        ['web-player.aligned-curation.tooltips.add-to-your-episodes', 'Add to Your Episodes'],
        ['contextmenu.save-to-your-episodes', 'Save to Your Episodes'],
      ],
      remove: [
        ['web-player.aligned-curation.tooltips.remove-from-your-episodes', 'Remove from Your Episodes'],
        ['contextmenu.remove-from-your-episodes', 'Remove from Your Episodes'],
      ],
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
      const adds = row.add.map(localized);
      const removes = row.remove.map(localized);
      const longest = (text, labels) =>
        Math.max(0, ...labels.filter((l) => text.startsWith(l)).map((l) => l.length));
      for (const cover of covers) {
        const li = cover.closest('li');
        if (!li) continue;
        // The row's trailing slot can carry a keyboard shortcut, so this
        // matches on the leading label rather than the whole row. Where one
        // label is a prefix of the other -- which happens in some languages --
        // the longer match wins.
        const text = (li.textContent || '').trim().toLowerCase();
        const addLength = longest(text, adds);
        const removeLength = longest(text, removes);
        li.classList.toggle('iceni-library-add', addLength > removeLength);
        if (addLength || removeLength) tagged += 1;
      }
    }
    status.libraryRows = tagged;
  }

  // ── 2. Recents button, wired to the Queue panel's Recently played tab ──
  function syncState() {
    const btn = document.getElementById(RECENTS_ID);
    const onHistory = panelOpen() && historyLive();
    document.body.classList.toggle('iceni-panel-history', onHistory);
    if (!btn) return;
    const active = onHistory ? 'true' : 'false';
    if (btn.getAttribute('data-active') !== active) btn.setAttribute('data-active', active);
    if (btn.getAttribute('aria-pressed') !== active) btn.setAttribute('aria-pressed', active);
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
    // Borrow the icon wrapper class from the sibling too: encore's prefix
    // (e-10451-, e-10860-, e-101040-) changes with every client release.
    const wrapper = sibling?.querySelector(':scope > span')?.className || '';
    btn.innerHTML = '<span aria-hidden="true" class="' + wrapper + '">'
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
    // The queue button sits a varying number of wrappers deep (two levels in
    // 1.3.4, three in 1.3.8), so climb to whichever ancestor is the strip's child.
    let queueSlot = strip.querySelector(QUEUE_SELECTOR);
    while (queueSlot && queueSlot.parentElement !== strip) queueSlot = queueSlot.parentElement;
    if (queueSlot) queueSlot.after(btn);
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

  Spicetify.Platform.History.listen(() => setTimeout(applyHeaderBanner, 60));
  applyHeaderBanner();

  // ── Now Playing View sections ────────────────────────────────────────
  // Since Spotify 1.3.8 no section carries a mapped class, not even About the
  // artist and Credits, so every section is found by structure: a section is
  // the outermost element in the panel that holds exactly one <h2>, found by
  // descending through every wrapper that holds several. It is matched on that
  // heading's text, and a wrapper with more than one heading is never hidden.
  const NPV_ROOT = '.Root__right-sidebar-expanded';
  const NPV_HIDE = ['related music videos', 'about the artist', 'credits', 'on tour'];

  function npvSections(node, found = []) {
    for (const child of node.children) {
      const count = child.querySelectorAll('h2').length;
      if (count === 1) found.push(child);
      else if (count > 1) npvSections(child, found);
    }
    return found;
  }

  function pruneNowPlayingView() {
    const root = document.querySelector(NPV_ROOT);
    if (!root) return;
    for (const section of npvSections(root)) {
      const label = section.querySelector('h2').textContent.trim().toLowerCase();
      section.classList.toggle('iceni-hidden-section', NPV_HIDE.includes(label));
    }
  }

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

  // ── 5. Spicy Lyrics "Update now": point at the real update path ───────
  //
  // Upstream resolves its own code at runtime, so its updater only has to
  // clear window._spicy_lyrics_metadata and reload: the loader then fetches
  // whatever api.spicylyrics.org calls latest. Iceni pins the bundle to disk
  // and writes LoadedVersion into it (scripts/vendor-spicy-lyrics.sh), so that
  // reload re-reads the same file and the version never moves -- the button
  // looks broken because, here, it is. An extension cannot fix that itself:
  // this code runs in Spotify's renderer, which has no way to write the file.
  //
  // So the click is intercepted before the navigation happens and turned into
  // the one thing that does work: the command that re-vendors and applies.
  // Blocking the push also keeps the update card's own handler from firing,
  // which is what leaves "previousVersion" untouched -- Spicy Lyrics compares
  // it against the running version on the next start, so once the script has
  // actually run it greets you with its own "Spicy Lyrics updated!" card.
  const UPDATE_ROUTE = '/SpicyLyrics/Update';
  const UPDATE_COMMAND =
    'cd "$(spicetify path userdata)/Themes/Iceni" && ' +
    './scripts/vendor-spicy-lyrics.sh --latest && spicetify apply';

  // Spicetify's History takes either a path string or a location object.
  const routeOf = (target) =>
    (typeof target === 'string' ? target.split(/[?#]/)[0] : target?.pathname) || '';

  function copyCommand(button) {
    const settle = (label) => {
      button.textContent = label;
      setTimeout(() => { button.textContent = 'Copy command'; }, 2000);
    };
    // Selecting the text is the honest fallback: the user can still copy it by
    // hand, which beats a button that reports success it did not have.
    const selectCommand = () => {
      const code = document.querySelector('.iceni-update-cmd');
      const selection = window.getSelection?.();
      if (!code || !selection) return settle('Copy failed');
      const range = document.createRange();
      range.selectNodeContents(code);
      selection.removeAllRanges();
      selection.addRange(range);
      settle('Text selected');
    };

    // navigator.clipboard first: it reports failure, where Spotify's own
    // bridge is fire-and-forget in some builds. Both are tried because
    // ClipboardAPI is the one that is certain to exist in the client.
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(UPDATE_COMMAND)
          .then(() => settle('Copied'), () => bridgeCopy(settle, selectCommand));
        return;
      }
    } catch (e) {
      console.warn('[Iceni] clipboard', e);
    }
    bridgeCopy(settle, selectCommand);
  }

  function bridgeCopy(settle, selectCommand) {
    const clipboard = window.Spicetify?.Platform?.ClipboardAPI;
    if (!clipboard?.copy) return selectCommand();
    try {
      const result = clipboard.copy(UPDATE_COMMAND);
      // It returns a promise in some builds and nothing in others.
      if (result && typeof result.then === 'function') {
        result.then(() => settle('Copied'), selectCommand);
      } else {
        settle('Copied');
      }
    } catch (e) {
      console.warn('[Iceni] clipboard bridge', e);
      selectCommand();
    }
  }

  // Reuses Spicy Lyrics' own update-card classes, which its stylesheet already
  // dresses (and user.css already retints), so this reads as part of it rather
  // than as a bolted-on Iceni dialog. Only .iceni-update-cmd is ours.
  function buildUpdateCard(close) {
    const version = window._spicy_lyrics_metadata?.LoadedVersion;

    const wrap = document.createElement('div');
    wrap.className = 'update-card-wrapper';

    const title = document.createElement('h2');
    title.className = 'uc-title';
    title.textContent = 'Update Spicy Lyrics';

    const subtitle = document.createElement('p');
    subtitle.className = 'uc-subtitle';
    subtitle.textContent =
      'Iceni pins Spicy Lyrics to a build on disk, so it cannot update itself ' +
      'from inside Spotify. Run this in a terminal -- it downloads the latest ' +
      'version, records it in vendor.lock and restarts the client.';

    wrap.append(title, subtitle);

    if (version) {
      const row = document.createElement('div');
      row.className = 'uc-version-row';
      const label = document.createElement('span');
      label.className = 'uc-ver';
      label.textContent = 'Installed';
      const value = document.createElement('span');
      value.className = 'uc-ver new';
      value.textContent = `v${version}`;
      row.append(label, value);
      wrap.append(row);
    }

    const command = document.createElement('pre');
    command.className = 'iceni-update-cmd';
    command.textContent = UPDATE_COMMAND;

    const actions = document.createElement('div');
    actions.className = 'uc-actions';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'btn-quiet';
    dismiss.textContent = 'Close';
    dismiss.addEventListener('click', close);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn-update';
    copy.textContent = 'Copy command';
    copy.addEventListener('click', () => copyCommand(copy));
    actions.append(dismiss, copy);

    wrap.append(command, actions);
    return wrap;
  }

  function showUpdateDialog() {
    status.updateDialogs += 1;

    // <sl-generic-modal> is Spicy Lyrics' modal custom element. The instance it
    // keeps is only in the DOM while a modal is open, so fall back to a fresh
    // one -- display() appends itself and hide() takes it away again.
    let host = document.querySelector('sl-generic-modal');
    if (!host && window.customElements?.get('sl-generic-modal')) {
      host = document.createElement('sl-generic-modal');
    }

    if (typeof host?.display === 'function') {
      const close = () => host.hide();
      // Arriving from the update card means a modal is already on screen.
      // transition() swaps the content and runs the outgoing onClose, so their
      // React root is unmounted rather than left behind.
      if (host.isConnected && host.querySelector('.sl-modal')) {
        host.transition({ title: 'Spicy Lyrics', content: buildUpdateCard(close) });
      } else {
        host.display({ title: 'Spicy Lyrics', content: buildUpdateCard(close) });
      }
      return;
    }

    // Nothing should reach this route with Spicy Lyrics unloaded, but swallow
    // the click into a plain Spotify modal rather than into nothing.
    const popup = window.Spicetify?.PopupModal;
    if (popup) {
      popup.display({ title: 'Spicy Lyrics', content: buildUpdateCard(() => popup.hide()) });
    }
  }

  // Wrapping History rather than the buttons: the route string is the one part
  // of the bundle that survives minification, where the button classes and the
  // toast markup do not. Spicy Lyrics navigates with
  // Spicetify.Platform.History.push(...), looking the method up at call time,
  // so replacing it here catches the update card, the toast action and the
  // settings footer link alike.
  function hookUpdateRoute() {
    const history = window.Spicetify?.Platform?.History;
    if (!history || history.__iceniUpdateHook) return;
    for (const method of ['push', 'replace']) {
      const original = history[method];
      if (typeof original !== 'function') continue;
      history[method] = function iceniHistory(...args) {
        if (routeOf(args[0]) === UPDATE_ROUTE) { showUpdateDialog(); return undefined; }
        return original.apply(this, args);
      };
    }
    history.__iceniUpdateHook = true;
    status.updateHooked = true;
  }

  try {
    hookUpdateRoute();
  } catch (e) {
    console.error('[Iceni] update route', e);
  }

  // ── 6. Folder images in Your Library ─────────────────────────────────
  //
  // Spotify has no folder artwork to set: a rootlist folder carries a name
  // and its children and nothing else, and no API accepts a cover for one.
  // So the picture is ours. It is chosen from the folder's right-click menu
  // or the settings page, re-encoded to a small square on a canvas, kept in
  // localStorage, and painted over the generic folder glyph. Nothing is uploaded and nothing leaves this
  // machine, so a phone, the web player and a second install all still show
  // the plain glyph.
  //
  // Rows are matched by URI where the client puts one on the row, and by
  // folder name against the rootlist where it does not. Only rows that link
  // to no entity page are eligible for the name path, so a playlist sharing a
  // folder's name is never mistaken for it; a name two folders both use is
  // dropped from that path entirely and only their URI can match.
  //
  // The image is published as a CSS variable on the row's artwork box rather
  // than as an inserted <img>. That box is React's and is already the right
  // size in the wide sidebar and in the collapsed icon rail, so nothing React
  // owns is removed, reordered or measured into place; user.css hides the
  // glyph inside it and draws the picture.
  const ART_KEY = 'iceni:folder-art';
  // The sidebar draws these at 32-48 CSS px, so 96 covers a 2x display. A
  // square that size is a few KB of WebP, and a library full of folders still
  // fits in the few megabytes localStorage allows -- where the original files
  // would blow the quota on the first phone photo.
  const ART_EDGE = 96;
  const ART_QUOTA = 2000000;
  const FOLDER_URI = /^spotify:user:[^:]+:folder:/;
  const FOLDER_LABEL = '[aria-labelledby*=":folder:"]';
  const FOLDER_URI_ID = /spotify:user:[^\s:]+:folder:[0-9a-f]+/i;
  const NAV_BAR = '.Root__nav-bar, #Desktop_LeftSidebar_Id';
  const ROW_SELECTOR = 'li, [role="row"], [role="gridcell"], [draggable="true"]';
  const ENTITY_LINK = 'a[href^="/playlist/"], a[href^="/album/"], a[href^="/artist/"],'
    + ' a[href^="/show/"], a[href^="/episode/"], a[href^="/collection/"]';
  const SETTINGS_HEADER =
    "[data-testid='settings-page'] > div:first-of-type, .x-settings-headerContainer";

  function readArt() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ART_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      console.warn('[Iceni] folder art unreadable', e);
      return {};
    }
  }

  let artCache = readArt();
  let folderIndex = [];
  const folderByName = new Map();
  let folderListEl = null;
  let folderStatusEl = null;
  let picker = null;
  let pickerTarget = null;

  // Returns null when stored, or the message to show the user when not.
  function writeArt(art) {
    const raw = JSON.stringify(art);
    if (raw.length > ART_QUOTA) {
      return 'Not saved: that is more local storage than Iceni will take. Remove an image first.';
    }
    try {
      localStorage.setItem(ART_KEY, raw);
    } catch (e) {
      console.error('[Iceni] folder art', e);
      return 'Not saved: this Spotify profile is out of local storage.';
    }
    artCache = art;
    schedule(paintFolders);
    return null;
  }

  async function refreshFolders() {
    const rootlist = window.Spicetify?.Platform?.RootlistAPI;
    if (!rootlist?.getContents) return folderIndex;
    let root;
    try {
      root = await rootlist.getContents();
    } catch (e) {
      console.warn('[Iceni] rootlist', e);
      return folderIndex;
    }
    const found = [];
    const walk = (node, path) => {
      for (const item of node?.items ?? []) {
        if (item?.type !== 'folder' || !item.uri) continue;
        const trail = [...path, item.name];
        found.push({ uri: item.uri, name: item.name, path: trail });
        walk(item, trail);
      }
    };
    walk(root, []);
    folderIndex = found;
    folderByName.clear();
    for (const folder of found) {
      // Two folders under the same name cannot be told apart from a row, so
      // the name path is closed for both and only their URI can match.
      folderByName.set(folder.name, folderByName.has(folder.name) ? null : folder);
    }
    status.folders = found.length;
    return found;
  }

  function rowFolderUri(row) {
    // Every library row is labelled by an element whose id embeds the row's
    // URI ("listrow-title-spotify:user:...:folder:..."). That is exact, it
    // survives a rename, and a playlist row carries :playlist: there instead,
    // so it never collides. Tried first; the two paths below are fallbacks for
    // a client that stops emitting it.
    const labelled = row.matches(FOLDER_LABEL) ? row : row.querySelector(FOLDER_LABEL);
    const labelledUri = labelled?.getAttribute('aria-labelledby')?.match(FOLDER_URI_ID);
    if (labelledUri) return labelledUri[0];
    const carrier = row.matches('[data-uri]') ? row : row.querySelector('[data-uri]');
    const uri = carrier?.getAttribute('data-uri');
    if (uri) return FOLDER_URI.test(uri) ? uri : null;
    // No URI on the row, so fall back to the label. Anything linking to an
    // entity page is a playlist, album, artist or show row, never a folder.
    if (!folderByName.size || row.querySelector(ENTITY_LINK)) return null;
    for (const el of row.querySelectorAll('*')) {
      if (el.firstElementChild) continue;
      const hit = folderByName.get((el.textContent || '').trim());
      if (hit) return hit.uri;
    }
    return null;
  }

  // The artwork slot is the nearest square ancestor of the glyph: a playlist
  // puts its cover in that same box, so squareness identifies it whatever the
  // class is called this month. Read-only, and only ever reached on a mounted
  // row, so the rects are real.
  function artworkBox(glyph, row) {
    let el = glyph;
    for (let depth = 0; depth < 3 && el.parentElement && el.parentElement !== row; depth += 1) {
      el = el.parentElement;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && Math.abs(rect.width - rect.height) <= 2) return el;
    }
    // Nothing square above it: paint the glyph's own box rather than risk
    // filling the whole row with the picture.
    return glyph;
  }

  function clearArt(el) {
    el.style.removeProperty('--iceni-folder-art');
    el.classList.remove('iceni-folder-art');
  }

  function paintFolders() {
    const nav = document.querySelector(NAV_BAR);
    if (!nav) return;
    // Nothing stored and nothing painted is the normal state for anyone who
    // has not chosen an image, and it must not cost a sidebar walk.
    const wanted = Object.keys(artCache).length;
    if (!wanted && !status.folderArt) return;

    let painted = 0;
    for (const row of nav.querySelectorAll(ROW_SELECTOR)) {
      const glyph = row.querySelector('svg');
      if (!glyph) continue;
      const uri = wanted ? rowFolderUri(row) : null;
      const art = uri ? artCache[uri] : null;
      if (!art) {
        // React recycles these rows as the list scrolls, so a row that no
        // longer belongs to a pictured folder has to be handed back plain.
        for (const stale of row.querySelectorAll('.iceni-folder-art')) clearArt(stale);
        continue;
      }
      const box = artworkBox(glyph, row);
      const next = `url("${art}")`;
      // Compared before writing: this runs from the DOM observer, and an
      // unconditional write would keep waking it up.
      if (box.style.getPropertyValue('--iceni-folder-art') !== next) {
        box.style.setProperty('--iceni-folder-art', next);
      }
      box.classList.add('iceni-folder-art');
      painted += 1;
    }
    status.folderArt = painted;
  }

  // Canvas re-encode rather than storing the file as picked: a phone photo is
  // several megabytes and localStorage holds a few in total. The centre square
  // is kept, because the slot it lands in is square.
  function encodeSquare(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = ART_EDGE;
        canvas.height = ART_EDGE;
        const ctx = side ? canvas.getContext('2d') : null;
        if (!ctx) return reject(new Error('That file could not be read as an image.'));
        ctx.drawImage(
          image,
          (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side,
          0, 0, ART_EDGE, ART_EDGE
        );
        // The client is Chromium, so WebP is expected. A canvas that cannot
        // produce it returns a PNG instead, which is several times the size at
        // this edge, so JPEG is the better fallback.
        let data = canvas.toDataURL('image/webp', 0.82);
        if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', 0.85);
        return resolve(data);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('That file could not be read as an image.'));
      };
      image.src = url;
    });
  }

  // ── The picker, rendered onto the settings page ──────────────────────
  function make(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  function setFolderStatus(message) {
    if (folderStatusEl) folderStatusEl.textContent = message;
  }

  function filePicker() {
    if (picker) {
      // The settings section adopts this node when it mounts, so it leaves the
      // document when that section does. The context menu can open long after.
      if (!picker.isConnected) document.body.append(picker);
      return picker;
    }
    picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.hidden = true;
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      const uri = pickerTarget;
      // Cleared before the await, so picking the same file twice in a row
      // still fires a change event the second time.
      picker.value = '';
      if (!file || !uri) return;
      try {
        setFolderStatus(writeArt({ ...readArt(), [uri]: await encodeSquare(file) }) || '');
      } catch (e) {
        console.error('[Iceni] folder art', e);
        setFolderStatus(e.message || 'That image could not be used.');
      }
      renderFolderList();
    });
    document.body.append(picker);
    return picker;
  }

  // ── The same picker, on the folder's own right-click menu ────────────
  // Rows are appended, never removed or reordered: this menu is React
  // rendered, and the profile menu above already shows what deleting one of
  // its children costs. The right-click listener only records which folder the
  // click landed on and never calls preventDefault, so Spotify opens and fills
  // its own menu exactly as before -- Rename, Delete and the rest are
  // untouched.
  let contextFolderUri = null;

  function folderUnderPointer(target) {
    const nav = target?.closest?.(NAV_BAR);
    if (!nav) return null;
    // The URI can sit on the row or on a wrapper above it, so walk out through
    // the candidate rows until one resolves rather than trusting the innermost.
    let node = target.closest(ROW_SELECTOR);
    while (node && nav.contains(node)) {
      const uri = rowFolderUri(node);
      if (uri) return uri;
      node = node.parentElement?.closest(ROW_SELECTOR);
    }
    return null;
  }

  document.addEventListener('contextmenu', (event) => {
    contextFolderUri = folderUnderPointer(event.target);
    // The title of the row that was right-clicked, for the playlist picker's
    // heading (section 9). Read here because the menu itself carries only uris.
    try {
      const row = event.target?.closest?.('[role="row"], [data-testid="now-playing-widget-v2"]');
      // A track row's title is its first plain text element; the artist and
      // album beside it are links. The mapped class is tried first.
      const title = row?.querySelector(
        '.main-trackList-rowTitle, a[href^="/track/"], div[data-encore-id="text"][dir="auto"]'
      );
      contextTrackName = (title?.textContent || '').trim();
    } catch (_) {
      contextTrackName = '';
    }
  }, true);

  // Clones a row of the menu it is going into, so the entry inherits whatever
  // Spotify styles that menu with this month. The clone is ours the moment it
  // is detached, so unlike the row it came from it can be stripped of its icon
  // and rewired; nothing React owns is touched.
  function menuRow(list, label, glyph, onClick) {
    // Never a submenu parent: that row carries a second glyph and a flyout
    // that would come along in the clone.
    const template = [...list.querySelectorAll(':scope > li')].find((li) =>
      !li.classList.contains('iceni-folder-menu-item')
      && !li.classList.contains('iceni-add-menu-item')
      && li.querySelector('button, a')
      && !li.querySelector('[aria-expanded]')
      && getComputedStyle(li).display !== 'none');
    const li = template?.cloneNode(true);
    const oldControl = li?.querySelector('button, a');
    if (!oldControl) return null;
    li.classList.add('iceni-folder-menu-item');
    // The first svg is the row's icon, in a slot Spotify has already sized and
    // placed; redraw it rather than dropping it, which is what left the entry
    // with an empty gap where every other row has a glyph. Anything after it
    // belongs to the template, not to us.
    const icon = li.querySelector('svg');
    if (icon) icon.innerHTML = glyph;
    for (const extra of li.querySelectorAll('svg ~ svg, img')) extra.remove();
    // A clean copy of the control, so no React handler comes along with it,
    // and without the href that would navigate if the template was a link.
    const control = document.createElement(oldControl.tagName);
    for (const { name, value } of oldControl.attributes) {
      if (name !== 'href') control.setAttribute(name, value);
    }
    control.innerHTML = oldControl.innerHTML;
    const text = [...control.querySelectorAll('span')]
      .find((span) => span.textContent.trim()) || control;
    text.textContent = label;
    oldControl.replaceWith(control);
    control.addEventListener('click', onClick);
    li.addEventListener('mouseenter', () => closeOpenSubmenu(list));
    return li;
  }

  // Spotify closes an open submenu -- "Move to folder" -- when another of its
  // own items is entered, not when the pointer leaves the parent row. That is
  // React's onMouseEnter on each item's button. Our row has no fiber, so
  // entering it fires nothing and the flyout stays open across it.
  //
  // Dispatching mouseover or mouseout at those nodes does not reach it: React
  // synthesises enter/leave from its own bookkeeping and ignores the injected
  // events (all three variants were tried against the running client). So the
  // handler React itself put on the node is called directly. It is an internal
  // -- __reactProps$<build hash> -- hence the prefix lookup and the try/catch:
  // if a future build renames it the flyout simply stays open as it does now.
  // A neighbour with no submenu of its own is used, so this closes the open
  // one without opening another, and the row highlight is pure CSS :hover so
  // nothing lights up under a pointer that is not there.
  function closeOpenSubmenu(list) {
    if (!list.querySelector('[aria-expanded="true"]')) return;
    const neighbour = [...list.querySelectorAll(':scope > li')].find((li) =>
      !li.classList.contains('iceni-folder-menu-item') && !li.querySelector('[aria-expanded]'));
    const control = neighbour?.querySelector('button, a');
    if (!control) return;
    try {
      const key = Object.keys(control).find((name) => name.startsWith('__reactProps$'));
      control[key]?.onMouseEnter?.({
        currentTarget: control,
        target: control,
        relatedTarget: null,
        type: 'mouseenter',
        preventDefault() {},
        stopPropagation() {},
        persist() {},
        nativeEvent: {},
      });
    } catch (e) {
      console.warn('[Iceni] submenu', e);
    }
  }

  function addFolderArtRows(menu) {
    const list = menu.querySelector('ul');
    if (!list) return;
    const present = list.querySelectorAll(':scope > li.iceni-folder-menu-item');
    // #context-menu is reused for every menu in the client, so these have to
    // come back off the ones they do not belong to.
    if (!contextFolderUri || isProfileMenu(list)) {
      for (const li of present) li.remove();
      return;
    }
    if (present.length) return;

    const uri = contextFolderUri;
    const rows = [menuRow(list, artCache[uri] ? 'Replace image' : 'Choose image',
      GLYPHS.image, () => {
        pickerTarget = uri;
        filePicker().click();
      })];
    if (artCache[uri]) {
      rows.push(menuRow(list, 'Remove image', GLYPHS.removeImage, () => {
        const next = readArt();
        delete next[uri];
        writeArt(next);
        renderFolderList();
      }));
    }
    // Both are built before either is appended, so the second never clones the
    // first as its template.
    if (!rows[0]) return;
    for (const row of rows) if (row) list.append(row);
    status.folderMenuRows += 1;
  }

  function renderFolderList() {
    if (!folderListEl) return;
    const art = readArt();
    folderListEl.textContent = '';
    if (!folderIndex.length) {
      folderListEl.append(make('li', 'iceni-folder-empty',
        'No folders in your library. Create one in the sidebar and it appears here.'));
      return;
    }
    for (const folder of folderIndex) {
      const row = make('li', 'iceni-folder-row');
      const thumb = make('span', 'iceni-folder-thumb');
      if (art[folder.uri]) {
        thumb.style.setProperty('--iceni-folder-art', `url("${art[folder.uri]}")`);
        thumb.classList.add('iceni-folder-art');
      }
      const label = make('span', 'iceni-folder-label');
      label.append(make('span', 'iceni-folder-name', folder.name));
      if (folder.path.length > 1) {
        label.append(make('span', 'iceni-folder-path',
          `in ${folder.path.slice(0, -1).join(' / ')}`));
      }
      const choose = make('button', 'iceni-folder-button',
        art[folder.uri] ? 'Replace' : 'Choose image');
      choose.type = 'button';
      choose.addEventListener('click', () => {
        pickerTarget = folder.uri;
        setFolderStatus('');
        filePicker().click();
      });
      row.append(thumb, label, choose);
      if (art[folder.uri]) {
        const remove = make('button', 'iceni-folder-button iceni-folder-remove', 'Remove');
        remove.type = 'button';
        remove.addEventListener('click', () => {
          const next = readArt();
          delete next[folder.uri];
          setFolderStatus(writeArt(next) || '');
          renderFolderList();
        });
        row.append(remove);
      }
      folderListEl.append(row);
    }
  }

  // Folder URIs are stable, so a stored key with no folder behind it means the
  // folder was deleted. Only ever run on a read that returned folders: a
  // failed or empty rootlist must not be taken as "they are all gone".
  function pruneArt() {
    if (!folderIndex.length) return;
    const live = new Set(folderIndex.map((folder) => folder.uri));
    const art = readArt();
    const stale = Object.keys(art).filter((uri) => !live.has(uri));
    if (!stale.length) return;
    for (const uri of stale) delete art[uri];
    writeArt(art);
  }

  function buildFolderSettings() {
    const section = make('div', 'x-settings-section iceni-folder-settings');
    const title = make(
      'h2',
      'TextElement-bodyMediumBold-textBase-text encore-text-body-medium-bold',
      'Folder images'
    );
    title.setAttribute('data-encore-id', 'type');
    const note = make('p', 'iceni-folder-note',
      'Spotify keeps no artwork for library folders, so these pictures are '
      + 'kept by Iceni instead. They live on this machine and are drawn over '
      + 'the folder icon in the sidebar; your phone and the web player still '
      + 'show the plain icon.');
    folderStatusEl = make('p', 'iceni-folder-note iceni-folder-status', '');
    folderListEl = make('ul', 'iceni-folder-list');
    folderListEl.append(make('li', 'iceni-folder-empty', 'Reading your library...'));
    section.append(title, note, folderListEl, folderStatusEl, filePicker());
    return section;
  }

  function mountFolderSettings() {
    if (window.Spicetify?.Platform?.History?.location?.pathname !== '/preferences') return;
    const header = document.querySelector(SETTINGS_HEADER);
    if (!header?.parentNode) return;
    if (header.parentNode.querySelector('.iceni-folder-settings')) return;
    // Below the accent picker theme.js renders, when that one is there.
    (header.parentNode.querySelector('.iceni-settings') || header).after(buildFolderSettings());
    refreshFolders().then(() => {
      pruneArt();
      renderFolderList();
    }).catch((e) => console.error('[Iceni] folders', e));
  }

  // The settings page mounts asynchronously, so the shared observer is what
  // usually places the section; this covers a navigation onto a page that is
  // already in the DOM.
  Spicetify.Platform.History.listen((location) => {
    if (location?.pathname === '/preferences') setTimeout(mountFolderSettings, 60);
  });

  paintFolders();
  refreshFolders().then(paintFolders).catch((e) => console.error('[Iceni] folders', e));

  // ── 8. Spicy Lyrics' Now Playing visual rules, only when needed ───────
  //
  // Spicy Lyrics ships about seventy rules that restyle the canvas / video
  // artwork in the Now Playing view, written as
  //   aside :is(.main-nowPlayingView-coverArtVisualEnhancement ~ * *)
  //     :has(video, ...)::before { display: none }
  // Their subject is every element inside the right-hand panel, each tested
  // with a descendant :has(). The Queue and Recently played lists live in that
  // same panel, so opening them made the engine run those tests against every
  // row: measured on Spotify 1.3.9, opening Recently played spent ~1250 ms in
  // style recalculation with the rules and ~390 ms without, and the longest
  // frozen frame went from ~490 ms to ~265 ms.
  //
  // The bundle is pinned and is not edited. Instead the rules are lifted out
  // of its stylesheet into one of ours, which is switched on only while an
  // element they depend on exists. A rule is moved only when every selector in
  // it requires such an element, so with none in the document it could not
  // have matched anything: the page renders the same, minus the matching work.
  // Anything this does not recognise is left exactly where Spicy Lyrics put it.
  const SPICY_STYLE_ID = 'slstyles';
  const SPICY_GATE_ID = 'iceni-spicy-visual-rules';
  const VISUAL_TOKEN =
    /\[data-testid="track-visual-enhancement"\]|\.main-nowPlayingView-coverArtVisualEnhancement|\.main-nowPlayingView-canvasVisualEnhancement/;
  const VISUAL_ANCHOR = '[data-testid="track-visual-enhancement"],'
    + ' .main-nowPlayingView-coverArtVisualEnhancement,'
    + ' .main-nowPlayingView-canvasVisualEnhancement';

  // Splits on commas that are not inside parentheses.
  function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === ',' && depth === 0) {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(text.slice(start));
    return parts.map((part) => part.trim()).filter(Boolean);
  }

  // What is left of a selector once everything optional is taken out: :not()
  // arguments, which name what must be absent, and any parenthesised list with
  // alternatives, where the anchor may be only one of the ways to match.
  function requiredPart(selector) {
    let out = '';
    let i = 0;
    while (i < selector.length) {
      const open = selector.indexOf('(', i);
      if (open === -1) { out += selector.slice(i); break; }
      let depth = 1;
      let close = open + 1;
      while (close < selector.length && depth > 0) {
        if (selector[close] === '(') depth += 1;
        else if (selector[close] === ')') depth -= 1;
        close += 1;
      }
      const head = selector.slice(i, open);
      const inner = selector.slice(open + 1, close - 1);
      out += head;
      const negated = /:not$/.test(head);
      if (!negated && splitTopLevel(inner).length === 1) out += ' ' + requiredPart(inner) + ' ';
      i = close;
    }
    return out;
  }

  const needsVisualAnchor = (selector) =>
    selector.includes(':has(') && VISUAL_TOKEN.test(requiredPart(selector));

  function syncSpicyVisualGate() {
    const gate = document.getElementById(SPICY_GATE_ID);
    if (!gate) return;
    const active = !!document.querySelector(VISUAL_ANCHOR);
    const media = active ? 'all' : 'not all';
    if (gate.media !== media) gate.media = media;
    status.spicyRulesActive = active;
  }

  function gateSpicyVisualRules() {
    const source = document.getElementById(SPICY_STYLE_ID);
    const sheet = source?.sheet;
    if (!sheet) return;
    const moved = [];
    try {
      for (let i = sheet.cssRules.length - 1; i >= 0; i -= 1) {
        const rule = sheet.cssRules[i];
        if (rule.type !== 1 || !rule.selectorText.includes(':has(')) continue;
        if (!splitTopLevel(rule.selectorText).every(needsVisualAnchor)) continue;
        moved.unshift(rule.cssText);
        sheet.deleteRule(i);
      }
    } catch (e) {
      console.warn('[Iceni] spicy visual rules', e);
      return;
    }
    // Nothing found on a later pass means the sheet is still the one already
    // processed, and the rules lifted out of it stay as they are.
    if (!moved.length) { syncSpicyVisualGate(); return; }
    let gate = document.getElementById(SPICY_GATE_ID);
    if (!gate) {
      gate = document.createElement('style');
      gate.id = SPICY_GATE_ID;
    }
    gate.textContent = moved.join('\n');
    // Directly after the sheet they came from, so they keep their place in the
    // cascade relative to every other stylesheet.
    if (gate.previousElementSibling !== source) source.after(gate);
    status.spicyRulesGated = moved.length;
    syncSpicyVisualGate();
  }

  // ── 9. Like and add-to-playlist as two buttons, with our own picker ───
  //
  // Spotify's player bar has one button for both jobs: it likes the track,
  // and once the track is liked it opens "Add to playlist" instead. That
  // picker opens folders as fly-out menus and applies nothing until Done is
  // pressed. Here the two jobs get a button each, and the playlist one opens a
  // picker of ours: folders expand in place, covers are large enough to
  // recognise, and ticking a row adds or removes the track there and then.
  //
  // Dropping Done means a slip of the pointer is a real change, and Spotify
  // has no undo for a removed playlist row (CLAUDE.md, rule 6). So every
  // removal -- from a playlist or from Liked Songs -- raises a toast with an
  // Undo that puts the track back. It goes back at the end of the playlist
  // with today's date: the original position and date-added are gone, and the
  // toast is the only thing standing between a misclick and that loss.
  //
  // Spotify's own button is hidden from user.css, never removed: it is
  // React's, and it is still what keeps time with the library for us (its
  // aria-checked flips whenever the track's saved state changes, wherever the
  // change came from). Only the player bar is affected; the Now Playing
  // panel, track rows and context menus keep Spotify's picker. Items that are
  // not tracks keep Spotify's button as well, since "like" does not mean the
  // same thing for an episode.
  //
  // Writes go through CurationAPI.curateItems, the call Spotify's own picker
  // makes, so the rest of the client hears about them. Every write is read
  // back before the row is allowed to keep its new state: LibraryAPI.add, for
  // one, resolves happily for a track the library then drops.
  const NP_WIDGET = '[data-testid="now-playing-widget-v2"]';
  const NATIVE_SAVE = NP_WIDGET
    + ' button[aria-checked]:not([role="switch"]):not([data-feedback-curated]):not([data-iceni])';
  const LIKE_ID = 'iceni-like-button';
  const ADD_ID = 'iceni-add-button';
  const PICKER_ID = 'iceni-playlist-picker';
  const TOAST_ID = 'iceni-toast';
  const PICKER_FOLDERS_KEY = 'iceni:picker-open-folders';

  const PICKER_ICONS = {
    heart: 'M1.69 2A4.582 4.582 0 0 1 8 2.023 4.583 4.583 0 0 1 11.88.817h.002a4.618 4.618 0 0 1 3.782 3.65v.003a4.543 4.543 0 0 1-1.011 3.84L9.35 14.629a1.765 1.765 0 0 1-2.093.464 1.762 1.762 0 0 1-.605-.463L1.348 8.309A4.582 4.582 0 0 1 1.689 2zm3.158.252A3.082 3.082 0 0 0 2.49 7.337l.005.005L7.8 13.664a.264.264 0 0 0 .311.069.262.262 0 0 0 .09-.069l5.312-6.33a3.043 3.043 0 0 0 .68-2.573 3.118 3.118 0 0 0-2.551-2.463 3.079 3.079 0 0 0-2.612.816l-.007.007a1.501 1.501 0 0 1-2.045 0l-.009-.008a3.082 3.082 0 0 0-2.121-.861z',
    heartFilled: 'M15.724 4.22A4.313 4.313 0 0 0 12.192.814a4.269 4.269 0 0 0-3.622 1.13.837.837 0 0 1-1.14 0 4.272 4.272 0 0 0-6.21 5.855l5.916 7.05a1.128 1.128 0 0 0 1.727 0l5.916-7.05a4.228 4.228 0 0 0 .945-3.577z',
    // A short list with a plus beside it: "put this in a list".
    addToList: 'M1 3.25a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 1 3.25zm0 4a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 1 7.25zm0 4a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75zm11.75-2.5a.75.75 0 0 1 .75.75v1.25h1.25a.75.75 0 0 1 0 1.5H13.5v1.25a.75.75 0 0 1-1.5 0v-1.25h-1.25a.75.75 0 0 1 0-1.5H12V9.5a.75.75 0 0 1 .75-.75z',
    chevron: 'M4.97.47a.75.75 0 0 0 0 1.06L11.44 8l-6.47 6.47a.75.75 0 1 0 1.06 1.06L13.56 8 6.03.47a.75.75 0 0 0-1.06 0z',
    folder: 'M1 4a2 2 0 0 1 2-2h3.243a2 2 0 0 1 1.414.586L8.83 3.757A.83.83 0 0 0 9.414 4H13a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V4zm2-.5a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5V6a.5.5 0 0 0-.5-.5H9.414a2.33 2.33 0 0 1-1.646-.682L6.596 3.646a.5.5 0 0 0-.353-.146H3z',
    check: 'M15.53 2.47a.75.75 0 0 1 0 1.06L4.907 14.153.47 9.716a.75.75 0 0 1 1.06-1.06l3.377 3.376L14.47 2.47a.75.75 0 0 1 1.06 0z',
    plus: 'M15.25 8a.75.75 0 0 1-.75.75H8.75v5.75a.75.75 0 0 1-1.5 0V8.75H1.5a.75.75 0 0 1 0-1.5h5.75V1.5a.75.75 0 0 1 1.5 0v5.75h5.75a.75.75 0 0 1 .75.75z',
    search: 'M7 1.75a5.25 5.25 0 1 0 0 10.5 5.25 5.25 0 0 0 0-10.5zM.25 7a6.75 6.75 0 1 1 12.096 4.12l3.184 3.185a.75.75 0 1 1-1.06 1.06L11.304 12.2A6.75 6.75 0 0 1 .25 7z',
    note: 'M10 2v9.5a2.75 2.75 0 1 1-2.75-2.75H8.5V2H10zm-1.5 8.25H7.25A1.25 1.25 0 1 0 8.5 11.5v-1.25z',
  };
  const pickerIcon = (name) =>
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="' + PICKER_ICONS[name] + '"/></svg>';

  // The same pair also sits at the front of Spicy Lyrics' fullscreen toolbar,
  // left of Translate, where the player bar is out of sight. That toolbar is
  // drawn with Lucide's 24px stroke icons, so these two use the same set
  // (heart, list-plus) to read as part of it; a liked track fills the heart.
  // Spicy Lyrics fills every toolbar svg that lacks its NoFill class.
  const LYRICS_CONTROLS = '#SpicyLyricsPage:not(.CardMode) .ViewControls';
  const LYRICS_LIKE_ID = 'iceni-lyrics-like';
  const LYRICS_ADD_ID = 'iceni-lyrics-add';
  const LUCIDE = {
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    listPlus: '<path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="M18 9v6"/><path d="M21 12h-6"/>',
  };
  const lucideIcon = (name, filled) =>
    '<svg' + (filled ? '' : ' class="NoFill"') + ' xmlns="http://www.w3.org/2000/svg"'
    + ' viewBox="0 0 24 24" width="24" height="24" fill="' + (filled ? 'currentColor' : 'none') + '"'
    + ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    + ' aria-hidden="true">' + LUCIDE[name] + '</svg>';

  const currentTrack = () => {
    const item = window.Spicetify?.Player?.data?.item;
    return item?.uri?.startsWith('spotify:track:') ? { uri: item.uri, name: item.name || '' } : null;
  };
  const curation = () => window.Spicetify?.Platform?.CurationAPI;
  const library = () => window.Spicetify?.Platform?.LibraryAPI;

  // ── Toast with Undo ──────────────────────────────────────────────────
  let toastTimer = null;
  function showToast(message, undo) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = make('div');
      toast.id = TOAST_ID;
      toast.setAttribute('role', 'status');
      document.body.append(toast);
    }
    toast.textContent = '';
    toast.append(make('span', 'iceni-toast-text', message));
    if (undo) {
      const button = make('button', 'iceni-toast-undo', 'Undo');
      button.type = 'button';
      button.addEventListener('click', () => {
        hideToast();
        undo();
      });
      toast.append(button);
    }
    toast.dataset.open = 'true';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undo ? 7000 : 3500);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    const toast = document.getElementById(TOAST_ID);
    if (toast) toast.dataset.open = 'false';
  }

  // ── Liked Songs: the heart ───────────────────────────────────────────
  let likeRequest = 0;
  // The last state painted, and for which track: a heart mounted later (the
  // fullscreen toolbar is rebuilt as the view changes) starts from it rather
  // than from empty while the library is asked again.
  let paintedLike = { uri: null, liked: false };

  // Every heart, wherever it is: data-iceni-like says which icon set it uses.
  function paintLike(liked) {
    paintedLike = { uri: currentTrack()?.uri ?? null, liked };
    const state = liked ? 'true' : 'false';
    for (const button of document.querySelectorAll('[data-iceni-like]')) {
      if (button.dataset.active === state) continue;
      button.dataset.active = state;
      button.setAttribute('aria-pressed', state);
      button.setAttribute('aria-label', liked ? 'Remove from Liked Songs' : 'Add to Liked Songs');
      if (button.dataset.iceniLike === 'lyrics') {
        button.innerHTML = lucideIcon('heart', liked);
      } else {
        button.querySelector('span').innerHTML = pickerIcon(liked ? 'heartFilled' : 'heart');
      }
    }
  }

  async function readLiked(uri) {
    const found = await library().contains(uri);
    return !!found?.[0];
  }

  function refreshLike() {
    const track = currentTrack();
    if (!track || !library()?.contains) return;
    const request = ++likeRequest;
    readLiked(track.uri).then((liked) => {
      // A slower answer for an earlier track must not paint over this one.
      if (request === likeRequest && currentTrack()?.uri === track.uri) paintLike(liked);
    }).catch((e) => console.warn('[Iceni] liked state', e));
  }

  async function setLiked(track, liked) {
    const request = ++likeRequest;
    if (currentTrack()?.uri === track.uri) paintLike(liked);
    let actual = !liked;
    try {
      await library()[liked ? 'add' : 'remove']({ uris: [track.uri] });
      actual = await readLiked(track.uri);
    } catch (e) {
      console.error('[Iceni] liked songs', e);
    }
    status.pickerWrites += 1;
    if (request === likeRequest && currentTrack()?.uri === track.uri) paintLike(actual);
    if (actual !== liked) {
      showToast(liked ? 'Could not add to Liked Songs' : 'Could not remove from Liked Songs');
      return;
    }
    if (!liked) {
      showToast('Removed from Liked Songs', () => setLiked(track, true));
    }
  }

  // ── The two buttons ──────────────────────────────────────────────────
  function curationButton(id, label, icon, template, wrapperClass) {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.dataset.iceni = 'curation';
    // Encore's own classes only: the sibling they are borrowed from also
    // carries a hashed class of its own that is none of our business.
    button.className = (template?.className || '').split(/\s+/)
      .filter((name) => /^(e-|encore-)/.test(name)).join(' ');
    button.setAttribute('data-encore-id', 'buttonTertiary');
    button.setAttribute('aria-label', label);
    button.innerHTML = '<span aria-hidden="true" class="' + wrapperClass + '">'
      + pickerIcon(icon) + '</span>';
    if (typeof Spicetify.Tippy === 'function') {
      try {
        Spicetify.Tippy(button, {
          ...(Spicetify.TippyProps || {}),
          content: label,
          onShow(instance) { instance.setContent(button.getAttribute('aria-label')); },
        });
      } catch (_) { button.title = label; }
    }
    return button;
  }

  function mountCurationButtons() {
    const native = document.querySelector(NATIVE_SAVE);
    if (!native) return;
    const host = native.parentElement;
    const track = currentTrack();
    const mode = track ? 'on' : 'off';
    if (host.getAttribute('data-iceni-curation') !== mode) {
      host.setAttribute('data-iceni-curation', mode);
    }
    if (!native.hasAttribute('data-iceni-native-save')) {
      native.setAttribute('data-iceni-native-save', '');
    }
    if (!document.getElementById(LIKE_ID) || !host.contains(document.getElementById(LIKE_ID))) {
      document.getElementById(LIKE_ID)?.remove();
      document.getElementById(ADD_ID)?.remove();
      const template = host.querySelector('button[data-feedback-curated]') || native;
      const wrapperClass = template.querySelector(':scope > span')?.className || '';
      const like = curationButton(LIKE_ID, 'Add to Liked Songs', 'heart', template, wrapperClass);
      like.dataset.iceniLike = 'bar';
      like.dataset.active = 'false';
      like.setAttribute('aria-pressed', 'false');
      like.addEventListener('click', () => {
        const now = currentTrack();
        if (now) setLiked(now, like.dataset.active !== 'true');
      });
      const add = curationButton(ADD_ID, 'Add to playlist', 'addToList', template, wrapperClass);
      add.setAttribute('aria-haspopup', 'dialog');
      add.addEventListener('click', () => togglePicker(add));
      native.after(like, add);
      status.curationButtons = true;
    }
    refreshLike();
  }

  // ── The same two in Spicy Lyrics' fullscreen toolbar ────────────────
  function lyricsButton(id, label) {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    // Spicy Lyrics' own class: its toolbar sizes, spaces and hovers these
    // exactly like its buttons, in every fullscreen layout it has.
    button.className = 'ViewControl';
    button.dataset.iceni = 'lyrics-curation';
    button.setAttribute('aria-label', label);
    if (typeof Spicetify.Tippy === 'function') {
      try {
        const tip = Spicetify.Tippy(button, {
          ...(Spicetify.TippyProps || {}),
          content: label,
          onShow(instance) { instance.setContent(button.getAttribute('aria-label')); },
        });
        tip?.popper?.classList.add('SpicyLyrics_Tooltip');
      } catch (_) { button.title = label; }
    }
    return button;
  }

  function mountLyricsCuration() {
    const controls = document.querySelector(LYRICS_CONTROLS);
    let like = document.getElementById(LYRICS_LIKE_ID);
    let add = document.getElementById(LYRICS_ADD_ID);
    if (!controls || !currentTrack()) {
      // No toolbar, or an episode or audiobook: nothing here to like.
      like?.remove();
      add?.remove();
      return;
    }
    if (!like) {
      like = lyricsButton(LYRICS_LIKE_ID, 'Add to Liked Songs');
      like.dataset.iceniLike = 'lyrics';
      like.innerHTML = lucideIcon('heart', false);
      like.addEventListener('click', (event) => {
        // Spicy Lyrics' buttons keep their clicks from the cover below them.
        event.preventDefault();
        event.stopPropagation();
        const now = currentTrack();
        if (now) setLiked(now, like.dataset.active !== 'true');
      });
    }
    if (!add) {
      add = lyricsButton(LYRICS_ADD_ID, 'Add to playlist');
      add.innerHTML = lucideIcon('listPlus', false);
      add.setAttribute('aria-haspopup', 'dialog');
      add.setAttribute('aria-expanded', 'false');
      add.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        togglePicker(add);
      });
    }
    // First in the toolbar, which in fullscreen puts them left of Translate.
    // The translator inserts its button at the front as well, so they are
    // moved back only when something has got in front; moving them is itself
    // a mutation that lands here, and it must find nothing left to do.
    if (controls.firstElementChild !== like || like.nextElementSibling !== add) {
      controls.prepend(like, add);
    }
    if (!like.dataset.active && paintedLike.uri === currentTrack()?.uri) {
      paintLike(paintedLike.liked);
    }
    status.lyricsCuration = true;
    if (!like.dataset.active) refreshLike();
  }

  // ── The picker ───────────────────────────────────────────────────────────────
  let playlistPicker = null;

  function readOpenFolders() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PICKER_FOLDERS_KEY) || '[]');
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (_) {
      return new Set();
    }
  }

  function closePicker() {
    if (!playlistPicker) return;
    playlistPicker.cleanup();
    playlistPicker.el.remove();
    playlistPicker.anchor?.setAttribute('aria-expanded', 'false');
    playlistPicker = null;
  }

  // A second click on the same button closes the picker; a click on the
  // other pair's button moves it there.
  function togglePicker(anchor) {
    if (playlistPicker) {
      const same = playlistPicker.anchor === anchor;
      closePicker();
      if (same) return;
    }
    const track = currentTrack();
    if (!track || !curation()?.getCurationContexts) return;
    openPicker(track, { anchor });
  }

  // Which of the user's playlists hold the track. One flat read; the folder
  // structure comes from the rootlist, which also knows what is writable.
  async function readMembership(uri) {
    const result = await curation().getCurationContexts({
      curatedItemUri: uri, limit: 2000, flatten: true,
    });
    const held = new Set();
    for (const item of result?.items ?? []) {
      if (item.type === 'playlist' && item.hasCuratedItems) held.add(item.uri);
    }
    return held;
  }

  function buildTree(root) {
    const walk = (node, path) => {
      const out = [];
      for (const item of node?.items ?? []) {
        if (item.type === 'folder') {
          const children = walk(item, [...path, item.name]);
          // A folder holding nothing the track can go into is only noise here.
          if (children.length) {
            out.push({ kind: 'folder', uri: item.uri, name: item.name, children });
          }
        } else if (item.type === 'playlist' && item.canAdd) {
          out.push({
            kind: 'playlist', uri: item.uri, name: item.name, path,
            image: item.images?.[0]?.url || '', count: item.totalLength,
          });
        }
      }
      return out;
    };
    return walk(root, []);
  }

  const playlistsIn = (nodes) => nodes.flatMap((node) =>
    (node.kind === 'folder' ? playlistsIn(node.children) : [node]));

  // `place` says where: { anchor } opens above a button that stays on screen
  // (the player bar), { rect } opens where a menu that is about to close was.
  function openPicker(track, place) {
    const anchor = place.anchor || null;
    closePicker();
    const el = make('div');
    el.id = PICKER_ID;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Add to playlist');

    const head = make('div', 'iceni-picker-head');
    head.append(make('span', 'iceni-picker-title', 'Add to playlist'),
      make('span', 'iceni-picker-track', track.name));
    // A track picked from a menu may come without its title; the playlist a
    // "New playlist" click creates still needs a name.
    const newPlaylistName = track.name || 'New playlist';

    const searchWrap = make('label', 'iceni-picker-search');
    searchWrap.innerHTML = pickerIcon('search');
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Find a playlist';
    search.setAttribute('aria-label', 'Find a playlist');
    search.spellcheck = false;
    searchWrap.append(search);

    const list = make('div', 'iceni-picker-list');
    list.append(make('div', 'iceni-picker-note', 'Reading your playlists...'));
    el.append(head, searchWrap, list);

    const width = 360;
    const clampLeft = (left) => Math.max(12, Math.min(left, window.innerWidth - width - 12));
    if (anchor) {
      // Above the button, left edges aligned, never taller than the room
      // there. Below it instead when the button is near the top of the
      // window, as Spicy Lyrics' fullscreen toolbar is.
      const rect = anchor.getBoundingClientRect();
      const above = rect.top - 28;
      const below = window.innerHeight - rect.bottom - 28;
      el.style.left = clampLeft(rect.left - 16) + 'px';
      if (above >= 360 || above >= below) {
        el.style.bottom = (window.innerHeight - rect.top + 12) + 'px';
        el.style.maxHeight = Math.max(240, Math.min(620, above)) + 'px';
      } else {
        el.style.top = (rect.bottom + 12) + 'px';
        el.style.maxHeight = Math.max(240, Math.min(620, below)) + 'px';
      }
    } else {
      // Where the menu was. The list has not loaded yet, so the height is not
      // known: reserve the tallest it may become and start high enough for
      // that to fit, rather than opening low and growing off the screen.
      const rect = place.rect;
      const maxHeight = Math.min(560, window.innerHeight - 24);
      el.style.left = clampLeft(rect.left) + 'px';
      el.style.top = Math.max(12, Math.min(rect.top, window.innerHeight - maxHeight - 12)) + 'px';
      el.style.maxHeight = maxHeight + 'px';
    }
    document.body.append(el);

    const state = {
      tree: [], held: new Set(), busy: new Set(),
      open: readOpenFolders(), query: '', failed: false,
    };

    const onPointerDown = (event) => {
      if (el.contains(event.target) || anchor?.contains(event.target)) return;
      if (event.target.closest?.('#' + TOAST_ID)) return;
      closePicker();
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (state.query) { search.value = ''; state.query = ''; render(); return; }
      closePicker();
      anchor?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    el.addEventListener('keydown', onKeyDown);
    playlistPicker = {
      el, anchor, trackUri: track.uri, followsPlayer: !!anchor,
      cleanup() { document.removeEventListener('pointerdown', onPointerDown, true); },
    };
    anchor?.setAttribute('aria-expanded', 'true');
    status.pickerOpens += 1;

    function cover(node) {
      const box = make('span', 'iceni-picker-cover');
      if (node.kind === 'folder') {
        const art = artCache[node.uri];
        if (art) box.style.backgroundImage = `url("${art}")`;
        else box.innerHTML = pickerIcon('folder');
      } else if (node.image) {
        const img = document.createElement('img');
        img.decoding = 'async';
        img.alt = '';
        img.src = node.image;
        box.append(img);
      } else {
        box.innerHTML = pickerIcon('note');
      }
      return box;
    }

    function playlistRow(node, showPath) {
      const held = state.held.has(node.uri);
      const row = make('button', 'iceni-picker-row');
      row.type = 'button';
      row.setAttribute('role', 'checkbox');
      row.setAttribute('aria-checked', held ? 'true' : 'false');
      if (state.busy.has(node.uri)) row.dataset.busy = 'true';
      const text = make('span', 'iceni-picker-text');
      text.append(make('span', 'iceni-picker-name', node.name));
      const detail = showPath && node.path.length
        ? node.path.join(' / ')
        : (typeof node.count === 'number' ? `${node.count} ${node.count === 1 ? 'song' : 'songs'}` : '');
      if (detail) text.append(make('span', 'iceni-picker-detail', detail));
      const mark = make('span', 'iceni-picker-mark');
      mark.innerHTML = pickerIcon('check');
      row.append(cover(node), text, mark);
      row.addEventListener('click', () => toggle(node));
      return row;
    }

    function folderRow(node) {
      const isOpen = state.open.has(node.uri);
      const members = playlistsIn(node.children);
      const heldInside = members.filter((child) => state.held.has(child.uri)).length;
      const wrap = make('div', 'iceni-picker-folder');
      const row = make('button', 'iceni-picker-row iceni-picker-folder-row');
      row.type = 'button';
      row.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      const text = make('span', 'iceni-picker-text');
      text.append(make('span', 'iceni-picker-name', node.name));
      text.append(make('span', 'iceni-picker-detail',
        `${members.length} ${members.length === 1 ? 'playlist' : 'playlists'}`));
      row.append(cover(node), text);
      // A closed folder still has to say that the track is somewhere in it.
      if (heldInside) row.append(make('span', 'iceni-picker-badge', String(heldInside)));
      const chevron = make('span', 'iceni-picker-chevron');
      chevron.innerHTML = pickerIcon('chevron');
      row.append(chevron);
      row.addEventListener('click', () => {
        if (state.open.has(node.uri)) state.open.delete(node.uri);
        else state.open.add(node.uri);
        try {
          localStorage.setItem(PICKER_FOLDERS_KEY, JSON.stringify([...state.open]));
        } catch (_) { /* the folder still opens; it just will not be remembered */ }
        render();
      });
      wrap.append(row);
      if (isOpen) {
        const children = make('div', 'iceni-picker-children');
        if (!node.children.length) {
          children.append(make('div', 'iceni-picker-note', 'No playlists you can add to.'));
        }
        for (const child of node.children) {
          children.append(child.kind === 'folder' ? folderRow(child) : playlistRow(child, false));
        }
        wrap.append(children);
      }
      return wrap;
    }

    function newPlaylistRow() {
      const row = make('button', 'iceni-picker-row iceni-picker-new');
      row.type = 'button';
      const box = make('span', 'iceni-picker-cover');
      box.innerHTML = pickerIcon('plus');
      const text = make('span', 'iceni-picker-text');
      text.append(make('span', 'iceni-picker-name', 'New playlist'),
        make('span', 'iceni-picker-detail', `Named "${newPlaylistName}"`));
      row.append(box, text);
      row.addEventListener('click', createPlaylist);
      return row;
    }

    function render() {
      const scroll = list.scrollTop;
      list.textContent = '';
      if (state.failed) {
        list.append(make('div', 'iceni-picker-note', 'Your playlists could not be read.'));
        return;
      }
      const query = state.query.trim().toLowerCase();
      if (query) {
        const hits = playlistsIn(state.tree)
          .filter((node) => node.name.toLowerCase().includes(query));
        if (!hits.length) list.append(make('div', 'iceni-picker-note', 'No playlist by that name.'));
        for (const node of hits) list.append(playlistRow(node, true));
        return;
      }
      list.append(newPlaylistRow());
      for (const node of state.tree) {
        list.append(node.kind === 'folder' ? folderRow(node) : playlistRow(node, false));
      }
      list.scrollTop = scroll;
    }

    async function write(node, add) {
      state.busy.add(node.uri);
      // Shown at once; the read-back below has the last word.
      if (add) state.held.add(node.uri); else state.held.delete(node.uri);
      render();
      let ok = false;
      try {
        await curation().curateItems(track.uri, add ? [node.uri] : [], add ? [] : [node.uri]);
        const held = await readMembership(track.uri);
        ok = held.has(node.uri) === add;
        state.held = held;
      } catch (e) {
        console.error('[Iceni] playlist write', e);
        if (add) state.held.delete(node.uri); else state.held.add(node.uri);
      }
      state.busy.delete(node.uri);
      status.pickerWrites += 1;
      if (playlistPicker?.el === el) render();
      return ok;
    }

    async function toggle(node) {
      if (state.busy.has(node.uri)) return;
      const add = !state.held.has(node.uri);
      const ok = await write(node, add);
      if (!ok) {
        showToast(add ? `Could not add to ${node.name}` : `Could not remove from ${node.name}`);
      } else if (!add) {
        showToast(`Removed from ${node.name}`, async () => {
          const back = await write(node, true);
          if (!back) showToast(`Could not put it back in ${node.name}`);
        });
      }
    }

    async function createPlaylist() {
      const rootlist = window.Spicetify?.Platform?.RootlistAPI;
      let uri = null;
      try {
        uri = await rootlist.createPlaylist(newPlaylistName, { before: 'start' });
        if (uri) await curation().curateItems(track.uri, [uri], []);
      } catch (e) {
        console.error('[Iceni] new playlist', e);
      }
      if (!uri) { showToast('Could not create the playlist'); return; }
      status.pickerWrites += 1;
      showToast(`Added to new playlist "${newPlaylistName}"`);
      await load();
    }

    async function load() {
      try {
        const [root, held] = await Promise.all([
          window.Spicetify.Platform.RootlistAPI.getContents(),
          readMembership(track.uri),
        ]);
        state.tree = buildTree(root);
        state.held = held;
        state.failed = false;
      } catch (e) {
        console.error('[Iceni] picker', e);
        state.failed = true;
      }
      if (playlistPicker?.el === el) render();
    }

    search.addEventListener('input', () => {
      state.query = search.value;
      render();
    });
    load();
    search.focus();
  }

  // The picker belongs to the track it was opened for. One opened from the
  // player bar is about the playing track and closes when that changes; one
  // opened from a right-click is about that row and stays.
  function onTrackChanged() {
    if (playlistPicker?.followsPlayer && playlistPicker.trackUri !== currentTrack()?.uri) {
      closePicker();
    }
    schedule(mountCurationButtons);
    schedule(mountLyricsCuration);
  }

  // ── The same picker from the right-click menu ────────────────────────
  // A track's context menu has its own "Add to playlist": a row that opens
  // the folder fly-outs. For a single track that row is hidden and one of
  // ours stands in its place, opening the picker above where the menu was.
  //
  // The row is recognised by what React rendered it from, not by its label:
  // Spotify marks the playlist submenu with the internal uri below and hands
  // the same component the uris the menu is about, so this works in any UI
  // language and tells us which track was clicked without guessing from the
  // DOM under the pointer. Both are internals (__reactFiber$<hash>), so every
  // read is guarded: if a build renames them nothing is tagged, nothing is
  // hidden, and Spotify's row works exactly as it does without Iceni.
  //
  // A selection of several tracks, an album or a playlist keeps Spotify's row.
  // The picker shows one track's memberships, and "in some of these but not
  // others" has no honest tick.
  const FOLDER_SUBMENU_URI = 'spotify:internal:foldersubmenu:root';
  const NATIVE_ADD_ROW = 'iceni-native-add-row';
  const ADD_MENU_ITEM = 'iceni-add-menu-item';
  let contextTrackName = '';

  function submenuUris(li) {
    try {
      const key = Object.keys(li).find((name) => name.startsWith('__reactFiber$'));
      let fiber = key ? li[key] : null;
      let uris = null;
      let isPlaylistSubmenu = false;
      for (let depth = 0; fiber && depth < 24; depth += 1) {
        const props = fiber.memoizedProps;
        if (props && typeof props === 'object') {
          if (!uris && Array.isArray(props.uris)) uris = props.uris;
          if (props.uri === FOLDER_SUBMENU_URI) isPlaylistSubmenu = true;
        }
        if (uris && isPlaylistSubmenu) return uris;
        fiber = fiber.return;
      }
    } catch (e) {
      console.warn('[Iceni] add-to-playlist row', e);
    }
    return null;
  }

  function closeContextMenu() {
    try {
      const owner = document.querySelector('[data-context-menu-open="true"]');
      if (owner?._tippy) { owner._tippy.hide(); return; }
    } catch (e) {
      console.warn('[Iceni] context menu', e);
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  function replaceAddToPlaylistRow(menu) {
    const list = menu.querySelector('ul');
    if (!list) return;
    let native = null;
    let trackUri = null;
    for (const li of list.querySelectorAll(':scope > li')) {
      if (li.classList.contains(ADD_MENU_ITEM) || !li.querySelector('[aria-expanded]')) continue;
      const uris = submenuUris(li);
      if (!uris) continue;
      if (uris.length === 1 && typeof uris[0] === 'string' && uris[0].startsWith('spotify:track:')) {
        native = li;
        trackUri = uris[0];
      }
      break;
    }
    // #context-menu and its rows are reused from one menu to the next, so a
    // tag or a row left over from the last one has to come off again.
    for (const li of list.querySelectorAll(':scope > li.' + NATIVE_ADD_ROW)) {
      if (li !== native) li.classList.remove(NATIVE_ADD_ROW);
    }
    const ours = list.querySelector(':scope > li.' + ADD_MENU_ITEM);
    if (!native || !curation()?.getCurationContexts) {
      ours?.remove();
      return;
    }
    if (ours && ours.previousElementSibling === native) {
      ours.dataset.uri = trackUri;
      native.classList.add(NATIVE_ADD_ROW);
      return;
    }
    ours?.remove();
    const row = menuRow(list, 'Add to playlist', '<path d="' + PICKER_ICONS.plus + '"/>', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const uri = row.dataset.uri;
      const rect = menu.getBoundingClientRect();
      const playing = currentTrack();
      const name = playing?.uri === uri ? playing.name : contextTrackName;
      closeContextMenu();
      openPicker({ uri, name }, { rect });
    });
    // Without a row to model ours on, Spotify's stays visible and in charge.
    if (!row) return;
    row.classList.remove('iceni-folder-menu-item');
    row.classList.add(ADD_MENU_ITEM);
    row.dataset.uri = trackUri;
    native.after(row);
    native.classList.add(NATIVE_ADD_ROW);
  }

  // ── Bootstrapping and re-application ─────────────────────────────────
  function apply() {
    try {
      // user.css addresses the strip through this attribute rather than with
      // div:has(> [data-testid="volume-bar"]): a :has() whose subject is any
      // div makes the engine re-check every insertion in the document, and
      // that showed up as style-recalc time while scrolling. An attribute
      // rather than a class, because React rewrites className wholesale.
      const strip = document.querySelector(CONTROLS);
      if (strip && !strip.hasAttribute('data-iceni-controls')) {
        strip.setAttribute('data-iceni-controls', '');
      }
      findConnectButton();
      addRecentsButton();
    } catch (e) {
      console.error('[Iceni] apply', e);
    }
  }
  apply();

  // Route DOM changes to the feature that owns them. Playback and lyrics
  // update continuously; they must not rescan every header, menu and sidebar.
  const jobs = new Set();
  let frame = null;
  function schedule(job) {
    jobs.add(job);
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const pending = [...jobs];
      jobs.clear();
      for (const run of pending) {
        try { run(); } catch (e) { console.error('[Iceni] DOM update', e); }
      }
    });
  }

  function updateMenus() {
    const menu = document.getElementById('context-menu');
    if (!menu) return;
    decorateMenu(menu);
    // Spotify resolves the saved state after painting the menu. The shared
    // observer routes that label change here without retaining closed menus.
    tagLibraryRows(menu);
    addFolderArtRows(menu);
    replaceAddToPlaylistRow(menu);
  }

  const targets = [
    [CONTROLS, apply],
    ['#queue-tab, #history-tab', syncState],
    ['.main-entityHeader-container', applyHeaderBanner],
    [NPV_ROOT + ' h2', pruneNowPlayingView],
    ['#context-menu', updateMenus],
    [NAV_BAR, paintFolders],
    ['[data-testid="settings-page"], .x-settings-headerContainer', mountFolderSettings],
    [VISUAL_ANCHOR, syncSpicyVisualGate],
    [NP_WIDGET, mountCurationButtons],
    [LYRICS_CONTROLS, mountLyricsCuration],
  ];
  const targetSelector = targets.map(([selector]) => selector).join(', ');
  function routeElement(element) {
    for (const [selector, job] of targets) {
      if (element.matches(selector)) schedule(job);
    }
  }
  function routeSubtree(node) {
    if (node.nodeType !== 1) return;
    routeElement(node);
    for (const match of node.querySelectorAll(targetSelector)) routeElement(match);
  }

  new MutationObserver((records) => {
    for (const record of records) {
      const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (!element) continue;
      if (record.type === 'attributes') {
        if (record.attributeName === 'aria-selected') {
          if (element.id === HISTORY_TAB || element.id === QUEUE_TAB) schedule(syncState);
        } else if (record.attributeName === 'aria-checked') {
          // Spotify's own save button, hidden but still told about every
          // change to the track's saved state, whoever made it.
          if (element.hasAttribute('data-iceni-native-save')) schedule(refreshLike);
        } else if (element.matches('img.main-entityHeader-image')) schedule(applyHeaderBanner);
        continue;
      }
      // Text and child replacements inside an existing feature also matter.
      const owner = element.closest(targetSelector);
      if (owner) {
        routeElement(owner);
      }
      for (const node of record.addedNodes) routeSubtree(node);
      for (const node of record.removedNodes) routeSubtree(node);
    }
  }).observe(document.body, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['aria-selected', 'aria-checked', 'src', 'srcset'],
  });
  document.addEventListener('load', (event) => {
    if (event.target?.matches?.('img.main-entityHeader-image')) schedule(applyHeaderBanner);
  }, true);
  updateMenus();

  mountCurationButtons();
  mountLyricsCuration();
  try {
    window.Spicetify?.Player?.addEventListener?.('songchange', onTrackChanged);
  } catch (e) {
    console.error('[Iceni] songchange', e);
  }

  // Spicy Lyrics injects its stylesheet while it starts, which can be after
  // this point, and puts it back if it ever rebuilds it. <head> changes a
  // handful of times in a session, so watching it costs nothing.
  gateSpicyVisualRules();
  new MutationObserver(() => schedule(gateSpicyVisualRules))
    .observe(document.head, { childList: true, subtree: true, characterData: true });

  console.log('[Iceni] customizations loaded');
})();
