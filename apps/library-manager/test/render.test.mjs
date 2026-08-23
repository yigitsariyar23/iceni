// Smoke test for the component tree.
//
// The app renders inside Spotify against Spicetify.React, which this cannot
// reach, so it stands up a real React of the same major version, points the
// global Spicetify at it, and renders to a string. Effects do not run under
// renderToString, so this exercises the first paint and the pure render path:
// it catches a broken element tree, a bad prop, or a crash on empty data --
// the failures that would otherwise only show up as a blank page in the client.
//
// Run with: npm run test:render

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

// Must be in place before the bundle is imported: the JSX factory resolves
// Spicetify.React at call time, but module-level destructuring of the hooks
// happens on import.
// The renderer has localStorage; Node does not. Without it the cache read
// throws on the first render and the warning buries the test output.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

globalThis.Spicetify = {
  React,
  ReactDOM: {},
  Platform: {},
  showNotification: () => {},
};

const { App } = await import('../dist-test/app.mjs');

let failures = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL ${name}\n     ${e.stack ?? e.message}`);
  }
};

test('the shell renders before any data has arrived', () => {
  const html = renderToString(React.createElement(App));
  assert.ok(html.includes('Library Manager'), 'title should be present');
  assert.ok(html.includes('Reading the library'), 'should show the pre-scan state');
  // The tabs only mount once a scan exists; nothing should be there yet.
  assert.ok(!html.includes('lm-tab--on'), 'tabs should not render without a scan');
});

test('no Platform API is touched during the first render', () => {
  // Spicetify.Platform is an empty object above. If any component read an API
  // at render time rather than inside an effect, this would already have
  // thrown in the test before it.
  const html = renderToString(React.createElement(App));
  assert.ok(html.length > 0);
});

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
