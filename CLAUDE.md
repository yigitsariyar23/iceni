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
   `vendor.lock` and are gitignored.

## Repo layout

The theme repo lives at `~/.config/spicetify/Themes/Iceni` (git initialized in
place). The SLT fork lives at `~/other-projects/slt-iceni` on branch `iceni`
with `upstream` pointing at 7xeh/SpicyLyricTranslator.

After changing the fork, run `./scripts/vendor-slt.sh` here to rebuild and
refresh `vendor.lock`, then `spicetify apply`.
