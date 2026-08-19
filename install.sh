#!/usr/bin/env bash
# Iceni'yi spicetify'a bağlar: extension'ları symlink'ler, config'i ayarlar.
# Tekrar tekrar çalıştırılabilir (idempotent). "spicetify apply" ÇALIŞTIRMAZ —
# Spotify'ı ne zaman yeniden başlatacağına sen karar ver.

set -euo pipefail
cd "$(dirname "$0")"
THEME_DIR="$PWD"
EXT_DIR="$HOME/.config/spicetify/Extensions"

mkdir -p "$EXT_DIR"

# extensions/ içindekileri Extensions/ altına symlink'le.
# Symlink sayesinde tek kaynak repo; kopya senkronu derdi yok.
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
echo "Config ayarlandı. Uygulamak için:"
echo "  spicetify apply"
