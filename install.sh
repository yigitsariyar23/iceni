#!/usr/bin/env bash
# Wires Iceni into spicetify: symlinks the extensions and sets the config.
# Safe to re-run (idempotent). Does NOT run "spicetify apply" -- you decide
# when to restart Spotify.

set -euo pipefail
cd "$(dirname "$0")"
THEME_DIR="$PWD"
EXT_DIR="$HOME/.config/spicetify/Extensions"

mkdir -p "$EXT_DIR"

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

spicetify config \
  current_theme    Iceni \
  color_scheme     iceni \
  inject_theme_js  1 \
  inject_css       1 \
  replace_colors   1 \
  overwrite_assets 1 \
  extensions       "$ext_list"

echo
echo "Config updated. To apply:"
echo "  spicetify apply"
