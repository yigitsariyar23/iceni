# Iceni -- working conventions

## Language: English only

Everything written into this repository is in English, with no exceptions:

- code identifiers and comments
- commit messages (subject and body)
- documentation, README, and inline docs
- shell script output, echo strings, and error messages
- user-facing strings in `theme.js` and any extension code

This applies to the SpicyLyricTranslator fork as well (see `vendor.lock` for its
location). Conversation about the work may be in any language; anything that
lands in a file or a commit is English.

## Commits: no trailers

Commit messages must not contain generated trailers of any kind. Specifically
never append:

- `Co-Authored-By: ...`
- `Generated with ...`
- any tool attribution line

A commit message is a subject line, a blank line, and a body explaining what
changed and why. Nothing after that.

## Finish every change with `spicetify apply`

A change here is not done until it is running in the client, so `spicetify
apply` is the last step of every edit -- theme CSS, `theme.js`, anything in
`extensions/`, and a custom app once `./scripts/build-apps.sh` has rebuilt its
`dist`. `spicetify refresh` is not a substitute: it reloads extensions only and
leaves stale CSS and a stale custom app behind.

It restarts Spotify when Spotify is open, and that is the intended cost. An
unapplied edit presents as "the rule did nothing", which is indistinguishable
from a selector Spotify has renamed, and that is an expensive hour to lose.

Read the config with `spicetify -c` and read the file it prints. `spicetify
config <key> <value>` *writes*; there is no two-argument read, so using it to
check a value silently overwrites the key instead.

## Design rules that should not be undone

These were deliberate decisions; do not "fix" them back:

1. **Nothing loads code remotely.** Both upstream extensions fetched and
   executed JavaScript at runtime. Everything is vendored to disk and recorded
   in `vendor.lock` with a sha256. Upgrades happen only by running the scripts
   in `scripts/` on purpose.
2. **No self-updaters, no telemetry.** Update checkers, hotfix pollers, and
   connectivity/heartbeat code are removed from the fork. Do not reintroduce
   them when rebasing onto upstream.
3. **Google is the only translation provider.** All other providers were
   removed. There is intentionally no fallback provider.
4. **One color scheme.** `color.ini` holds a single `[iceni]` scheme based on
   Catppuccin Frappe. Do not re-add the other flavors.
5. **Generated files stay out of git.** `extensions/*.js` are reproducible from
   `vendor.lock` and are gitignored, and so is `apps/*/dist`, which
   `scripts/build-apps.sh` rebuilds from the TypeScript source beside it.
6. **Bulk edits confirm first.** Everything in `apps/library-manager` that
   writes to the library states the exact row count and waits for a click.
   Spotify has no undo for a removed playlist row or an unliked track.

## Repo layout

The theme repo lives at `~/.config/spicetify/Themes/Iceni` (git initialized in
place). The SLT fork lives at `~/other-projects/slt-iceni` on branch `iceni`
with `upstream` pointing at 7xeh/SpicyLyricTranslator.

After changing the fork, run `./scripts/vendor-slt.sh` here to rebuild and
refresh `vendor.lock`, then `spicetify apply`.

Custom apps live in `apps/<name>` and are built with `./scripts/build-apps.sh`;
`install.sh` links each `dist` into `<spicetify userdata>/CustomApps` and merges
the name into the `custom_apps` config line, leaving entries it does not own
(Marketplace) alone.

`spicetify refresh` only picks up extensions, not theme CSS or a rebuilt custom
app -- those need a full `spicetify apply`, which restarts the client.
