#!/usr/bin/env bash
# Wires Iceni into spicetify: installs the extensions and sets the config.
# Safe to re-run (idempotent). Does NOT run "spicetify apply" -- you decide
# when to restart Spotify.
#
# Paths come from spicetify itself rather than being hardcoded, so this works
# on macOS, Linux and Windows (Git Bash), where the config lives in different
# places.

set -euo pipefail
# pwd -P resolves symlinks: spicetify's Themes/Iceni is a link into the real
# checkout, and everything below should work against the checkout itself.
cd "$(dirname "$0")"
THEME_DIR="$(pwd -P)"

command -v spicetify >/dev/null || { echo "spicetify not found in PATH" >&2; exit 1; }

CONFIG=$(spicetify -c)
EXT_DIR="$(spicetify path userdata)/Extensions"
mkdir -p "$EXT_DIR"

# Try a symlink so the repo stays the single source of truth; fall back to a
# copy where symlinks need privileges we do not have (Windows without
# Developer Mode). A copy means re-running this after editing an extension.
link_or_copy() {
  local src="$1" dst="$2"
  if ln -sfn "$src" "$dst" 2>/dev/null; then
    echo "symlink  $dst"
  else
    cp -f "$src" "$dst"
    echo "copy     $dst  (symlinks unavailable; re-run after edits)"
  fi
}

# Drop links/copies for extensions that no longer exist in the repo. Test for
# -L as well as -e: a symlink whose target has moved fails -e, so checking only
# -e skipped exactly the dangling links this is meant to clear.
for f in "$EXT_DIR"/iceni*.js; do
  [ -e "$f" ] || [ -L "$f" ] || continue
  name=$(basename "$f")
  [ -e "extensions/$name" ] || { rm -f "$f"; echo "stale removed: $name"; }
done

names=()
for f in extensions/*.js; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  link_or_copy "$THEME_DIR/$f" "$EXT_DIR/$name"
  names+=("$name")
done

ext_list=$(IFS='|'; echo "${names[*]}")

# home_config and experimental_features are what put Spicetify's own rows in
# the profile menu. Turning them off removes those rows at the source.
spicetify config \
  current_theme         Iceni \
  color_scheme          iceni \
  inject_theme_js       1 \
  inject_css            1 \
  replace_colors        1 \
  overwrite_assets      1 \
  home_config           0 \
  experimental_features 0

# "spicetify config extensions X" APPENDS to the existing list rather than
# replacing it, so an extension deleted from extensions/ would keep loading
# forever. Write the line directly instead. sed -i is not portable (BSD wants
# an argument, GNU does not), so write to a temp file and move it into place.
if grep -qE '^extensions[[:space:]]*=' "$CONFIG"; then
  sed -E "s#^extensions([[:space:]]*)=.*#extensions\1= ${ext_list}#" "$CONFIG" > "$CONFIG.iceni.tmp"
  mv "$CONFIG.iceni.tmp" "$CONFIG"
  echo "config   extensions = ${ext_list}"
else
  echo "warning: no 'extensions' line in $CONFIG" >&2
fi

echo
echo "Config updated. To apply:"
echo "  spicetify apply"
