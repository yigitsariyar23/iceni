# Performance verification

## September 2026: background DOM work

Iceni now routes structural changes to the affected controls and batches work
once per animation frame. It no longer rechecks the artwork header, sidebar
sections and Recents state for every unrelated DOM update. Menu label changes
use the same observer, without allocating an observer for each opened menu.

The translator fork observes lyrics view mounting/removal and the sidebar's
body flag instead of every class change on every lyric word. Settings watching
is active only on settings routes, after Spotify's History API is available.
Closing lyrics stops overlay animation and view-mode polling, and invalidates
pending view initialization so it cannot restart work after navigation away.

### Measurement

In Spotify 1.2.99.317 with Spicetify 2.44.0, on Home with playback paused and
lyrics closed, a temporary element received 120 text/class updates, each
separated by an animation frame. Document-level `querySelector` and
`querySelectorAll` calls were counted during that identical workload:

| Lookup | Before | After |
| --- | ---: | ---: |
| Settings containers | 240 | 0 |
| Lyrics visibility selectors | 964 | 0 |
| Artwork header | 120 | 0 |
| Now Playing sections | 120 | 0 |
| Total | 1,444 | 0 |

This measures eliminated document-wide lookups, not overall FPS or end-to-end
interaction latency. The filtered observers still process relevant mutation
records. Spotify itself and the pinned upstream lyrics renderer also perform
their own work.

### Regression checks

Start Spotify with `--remote-debugging-port=9222`, bring its window forward, and
run with Node 22 or newer:

```bash
node test/performance.mjs
```

`SPOTIFY_DEBUG_URL` can override the default `http://127.0.0.1:9222` endpoint.
The checks run in a temporary iframe, with no library writes. They exercise
unrelated DOM updates, control-strip replacement, Recents state, artwork
changes, sidebar label changes, profile menus and asynchronous library state.

The fork's `npm test` includes visibility, popup teardown, overlay shutdown,
and delayed History readiness tests. Its build runs TypeScript checking.
At this change, the full suite has 42 passing tests and 34 failures; all 34
failures also occur on the untouched fork baseline (many still expect removed
translation providers). No existing failure was introduced by this change.

Live checks also verified settings entry/re-entry and opening/closing Spicy
Lyrics, including its translation controls. The document scan count remained
zero after those navigation cycles. Installed extension hashes matched the
verified builds.
