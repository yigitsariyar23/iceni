// Run against a debuggable Spotify client: node test/performance.mjs
// Fixtures live in a temporary iframe; the Spotify library is never modified.
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../extensions/iceni.js', import.meta.url), 'utf8');
const endpoint = process.env.SPOTIFY_DEBUG_URL || 'http://127.0.0.1:9222';
const pages = await (await fetch(`${endpoint}/json/list`)).json();
const page = pages.find(page => page.type === 'page' && page.url.includes('xpui.app.spotify.com'));
if (!page) throw new Error('No Spotify debugging target found');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const timeout = setTimeout(() => { socket.close(); throw new Error('Browser checks timed out'); }, 20000);

async function checkTheme(source) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:-10000px;width:800px;height:600px';
  document.body.append(frame);
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  const passed = [];
  const assert = (condition, name) => { if (!condition) throw new Error(name); passed.push(name); };
  // Keep the fixture's scheduling deterministic even when it is offscreen.
  win.requestAnimationFrame = requestAnimationFrame.bind(window);
  win.cancelAnimationFrame = cancelAnimationFrame.bind(window);
  const settle = async () => {
    for (let i = 0; i < 4; i++) await new Promise(resolve => requestAnimationFrame(resolve));
  };
  const create = html => {
    const wrap = doc.createElement('div');
    wrap.innerHTML = html;
    const node = wrap.firstElementChild;
    doc.body.append(node);
    return node;
  };
  const controls = '<div class="main-nowPlayingBar-extraControls"><span><button>Device</button></span><button data-testid="control-button-queue">Queue</button></div>';
  const ART_KEY = 'iceni:folder-art';
  const ART_URI = 'spotify:user:test:folder:0000';
  const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const previousArt = localStorage.getItem(ART_KEY);
  try {
    const strip = create(controls);
    win.Spicetify = { Platform: { History: { listen() {}, push() {}, replace() {} } } };
    // Seeded before the extension loads: it reads the store once at startup.
    // The key is Iceni's own and is put back as it was in the finally below.
    localStorage.setItem(ART_KEY, JSON.stringify({ [ART_URI]: PIXEL }));
    win.eval(source);
    await settle();
    assert(!!doc.getElementById('iceni-recents-button'), 'Recents mounts at startup');
    assert(!!strip.querySelector('.iceni-connect-host'), 'Device picker is tagged');

    const probe = create('<div><span>0</span></div>');
    await settle();
    let queries = 0;
    const originals = {};
    for (const method of ['querySelector', 'querySelectorAll']) {
      originals[method] = doc[method];
      doc[method] = function(...args) { queries++; return originals[method].apply(this, args); };
    }
    for (let i = 0; i < 120; i++) {
      probe.firstChild.className = i % 2 ? 'active' : '';
      probe.firstChild.textContent = String(i);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    await settle();
    for (const method of Object.keys(originals)) doc[method] = originals[method];
    assert(queries === 0, `Unrelated updates cause zero document scans (received ${queries})`);

    const header = create('<div class="main-entityHeader-container"><img class="main-entityHeader-image"></div>');
    const img = header.firstChild;
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    await settle();
    assert(header.style.getPropertyValue('--iceni-banner').includes('data:image/gif'), 'Artwork is applied after header mounts');
    img.src += '#updated';
    await settle();
    assert(header.style.getPropertyValue('--iceni-banner').includes('#updated'), 'Artwork source changes refresh the banner');

    const section = create('<section class="main-nowPlayingView-section"><h2 class="main-nowPlayingView-sectionHeaderText">Credits</h2></section>');
    await settle();
    assert(section.classList.contains('iceni-hidden-section'), 'Excluded sidebar sections are hidden');
    section.firstChild.firstChild.data = 'Next in queue';
    await settle();
    assert(!section.classList.contains('iceni-hidden-section'), 'Reused sidebar sections become visible when their label changes');

    const tabs = create('<div><button id="queue-tab" aria-selected="true"></button><button id="history-tab" aria-selected="false"></button></div>');
    await settle();
    tabs.lastChild.setAttribute('aria-selected', 'true');
    await settle();
    assert(doc.getElementById('iceni-recents-button').getAttribute('aria-pressed') === 'true', 'Recents follows the selected history tab');
    tabs.remove();
    await settle();
    assert(doc.getElementById('iceni-recents-button').getAttribute('aria-pressed') === 'false', 'Recents clears when the panel closes');
    strip.remove();
    const replacement = create(controls);
    await settle();
    assert(!!replacement.querySelector('#iceni-recents-button'), 'Recents returns when Spotify replaces the control strip');

    const menu = create('<div id="context-menu"><ul><li><button><span>Settings</span></button></li><li><button>Log out</button></li></ul></div>');
    await settle();
    assert(menu.classList.contains('iceni-profile-menu') && menu.querySelectorAll('.iceni-device-row').length === 1, 'Profile menu gains exactly one device row');
    menu.remove();
    await settle();
    const trackMenu = create('<div id="context-menu"><ul><li><button><img src="data:,liked-songs"><span>Save to your Liked Songs</span></button></li></ul></div>');
    await settle();
    assert(!trackMenu.classList.contains('iceni-profile-menu') && !trackMenu.querySelector('.iceni-device-row'), 'Track menus retain their own layout');
    assert(trackMenu.querySelector('li').classList.contains('iceni-library-add'), 'Unsaved library rows receive the add icon');
    trackMenu.querySelector('span').firstChild.data = 'Remove from your Liked Songs';
    await settle();
    assert(!trackMenu.querySelector('li').classList.contains('iceni-library-add'), 'Resolved library state updates the icon');
    const nav = create(`<div class="Root__nav-bar"><ul><li draggable="true" data-uri="${ART_URI}"><div style="width:32px;height:32px"><svg></svg></div><span>Test folder</span></li></ul></div>`);
    await settle();
    const box = nav.querySelector('div');
    assert(box.classList.contains('iceni-folder-art')
      && box.style.getPropertyValue('--iceni-folder-art').includes('data:image/gif'),
      'Folder rows are painted from the stored image');

    return { passed, unrelatedDocumentScans: queries };
  } finally {
    frame.remove();
    if (previousArt === null) localStorage.removeItem(ART_KEY);
    else localStorage.setItem(ART_KEY, previousArt);
  }
}

try {
  const result = await new Promise((resolve, reject) => {
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    };
    socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{
      expression:`(${checkTheme.toString()})(${JSON.stringify(source)})`,
      awaitPromise:true,returnByValue:true,
    }}));
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  console.log(JSON.stringify(result.result.value, null, 2));
} finally { clearTimeout(timeout); socket.close(); }
