#!/usr/bin/env bash
# Wires Iceni into spicetify: symlinks the extensions and sets the config.
# Safe to re-run (idempotent). Does NOT run "spicetify apply" -- you decide
# when to restart Spotify.

set -euo pipefail
cd "$(dirname "$0")"
THEME_DIR="$PWD"
EXT_DIR="$HOME/.config/spicetify/Extensions"
CONFIG="$HOME/.config/spicetify/config-xpui.ini"

mkdir -p "$EXT_DIR"

# Drop symlinks pointing back at this repo whose target no longer exists, so a
# deleted extension does not linger in Extensions/.
for link in "$EXT_DIR"/*.js; do
  [ -L "$link" ] || continue
  target=$(readlink "$link")
  case "$target" in
    "$THEME_DIR"/*) [ -e "$target" ] || { rm -f "$link"; echo "stale link removed: $(basename "$link")"; } ;;
  esac
done

# Symlink everything in extensions/ into Extensions/. Symlinks keep this repo
# the single source of truth -- no copies to keep in sync.
names=()
for f in extensions/*.js; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  ln -sfn "$THEME_DIR/$f" "$EXT_DIR/$name"
  names+=("$name")
  echo "symlink  $EXT_DIR/$name -> $f"
done

ext_list=$(IFS='|'; echo "${names[*]}")

# home_config and experimental_features are what put Spicetify's own rows in
# the profile menu. Turning them off removes those rows at the source, which
# beats hiding them with CSS.
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
# forever. Write the line directly so the config always mirrors what is on disk.
if grep -qE '^extensions[[:space:]]*=' "$CONFIG"; then
  sed -i '' -E "s#^extensions([[:space:]]*)=.*#extensions\1= ${ext_list}#" "$CONFIG"
  echo "config   extensions = ${ext_list}"
else
  echo "warning: no 'extensions' line in $CONFIG" >&2
fi

echo
echo "Config updated. To apply:"
echo "  spicetify apply"
