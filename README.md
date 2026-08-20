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

## Install on a new machine

Iceni lives in two repositories: this one, and a private fork of
SpicyLyricTranslator that has to be built locally. Both are private.

```bash
# 1. spicetify itself
#    macOS/Linux: brew install spicetify-cli   (or the official installer)
#    Windows:     see spicetify.app/docs/getting-started

# 2. This repo, into spicetify's Themes directory
git clone git@github.com:yigitsariyar23/iceni.git \
  "$(spicetify path userdata)/Themes/Iceni"

# 3. The translator fork, as a sibling of the theme (or anywhere, see below)
git clone git@github.com:yigitsariyar23/slt-iceni.git \
  "$(spicetify path userdata)/Themes/slt-iceni"

# 4. Fetch and build the two extensions, then wire everything up
cd "$(spicetify path userdata)/Themes/Iceni"
./scripts/vendor-spicy-lyrics.sh   # downloads the pinned Spicy Lyrics build
./scripts/vendor-slt.sh            # builds the fork (needs node + npm)
./install.sh
spicetify apply
```

`vendor-slt.sh` looks for the fork next to this repo, then at
`~/other-projects/slt-iceni`. Anywhere else, point it at the checkout:

```bash
SLT_FORK=/path/to/slt-iceni ./scripts/vendor-slt.sh
```

Finally, uninstall Catppuccin, Spicy Lyrics and SpicyLyricTranslator from the
Spicetify Marketplace if they are installed there. Marketplace injects its own
copies at runtime, independently of these folders, and everything would load
twice.

### Windows notes

The theme itself is platform-neutral; the scripts are the part that cares.
They take every path from `spicetify -c` and `spicetify path userdata` rather
than hardcoding one, and avoid the BSD/GNU `sed -i` split, so they run under
Git Bash. Two things still differ:

- **Symlinks.** `install.sh` prefers a symlink and falls back to copying when
  symlinks need privileges the shell does not have, which is the default on
  Windows without Developer Mode. With a copy, re-run `./install.sh` after
  editing anything in `extensions/`.
- **Shell.** Run the scripts from Git Bash. They are bash, not PowerShell.

## Keeping up with Spotify updates

A Spotify update replaces the files Spicetify patches, so the theme disappears
until it is applied again:

```bash
spicetify backup apply
```

If Spotify has moved ahead of the installed Spicetify, upgrade it first
(`spicetify upgrade`), then run the line above.

Nothing else needs re-fetching: the extensions are pinned, so a Spotify update
cannot change them. What a Spotify update *can* do is rename the CSS classes
this theme targets, which shows up as a rule quietly doing nothing rather than
as an error.

To find those, compare the selectors in `user.css` against the class names in
the current build:

```bash
grep -ohE 'var\(--spice-[a-z0-9-]+|\.[A-Za-z_][\w-]*' user.css | sort -u
# then check a suspect class against the running client:
grep -rl "main-globalNav-searchContainer" \
  "$(spicetify path)/../Apps/xpui" --exclude=user.css
```

A class that appears nowhere in the build is dead. Roughly 22 selectors
inherited from Catppuccin are already in that state -- the elements still
exist but were renamed, so those rules need re-pointing rather than deleting.

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
