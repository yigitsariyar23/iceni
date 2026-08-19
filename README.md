# Iceni

Personal Spotify (Spicetify) theme + extension set.

## Layout

```
color.ini    Single color scheme: [iceni] -- based on Catppuccin Frappe
user.css     Theme CSS
theme.js     Accent color picker (added to the settings page)
extensions/iceni.js
             UI customizations that need behavior, not just CSS: the device
             picker moved into the profile menu, a Recents button in the
             player bar, profile-menu pruning, and a close button for the
             Spicy Popup Lyrics window
assets/      Equalizer GIFs, one per accent
extensions/  Spicetify extensions (symlinked by install.sh)
scripts/     Vendoring / maintenance scripts
vendor.lock  Pinned upstream versions + sha256
```

## Install

```bash
./install.sh      # symlinks + spicetify config
spicetify apply   # apply to Spotify (restarts Spotify)
```

## Why everything is vendored

Upstream Spicy Lyrics and SpicyLyricTranslator both **load code remotely**:

- `spicy-lyrics`: `builds/spicy-lyrics.mjs` -> jsDelivr `@main` -> `api.spicylyrics.org/version`
  -> `public.storage.spicylyrics.org/spicy-lyrics@<latest>.mjs`
- `SLT`: `loader/SLT-loader.js` -> fetch from `7xeh.dev` + `<script>` injection,
  plus a hotfix check every 30 minutes that can call `window.location.reload()`

The consequence is that the running code was never pinned and could not be
tracked in git. Iceni puts the code on disk instead; versions change only when
you upgrade them on purpose.

Upgrading:

```bash
./scripts/vendor-spicy-lyrics.sh --latest   # or: ./scripts/vendor-spicy-lyrics.sh 6.4.0
spicetify apply
```

If something breaks, `git log` and `vendor.lock` show what changed and when.

## Conventions

See [CLAUDE.md](CLAUDE.md). In short: everything in this repo -- code, comments,
commit messages, docs -- is written in English, and commits carry no generated
trailers.

## Upstream sources

| Project | Role |
|---|---|
| [catppuccin/spicetify](https://github.com/catppuccin/spicetify) | Theme base (forked, reduced to one scheme) |
| [Spikerko/spicy-lyrics](https://github.com/Spikerko/spicy-lyrics) | Lyrics engine (pinned, themed via CSS) |
| [7xeh/SpicyLyricTranslator](https://github.com/7xeh/SpicyLyricTranslator) | Translation layer (forked, Google-only) |
