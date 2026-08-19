#!/usr/bin/env bash
# SpicyLyricTranslator (Iceni fork) derler ve extensions/ altına kurar.
#
# Neden fork: upstream'in manifest'i loader/SLT-loader.js'i işaret ediyor;
# o loader 7xeh.dev'den kod indirip enjekte ediyor ve 30 dk'da bir hotfix
# kontrolüyle Spotify'ı yeniden yükleyebiliyor. Fork'ta loader ve updater
# kaldırıldı; kod tamamen yerelde derleniyor.
#
# Upstream'den güncelleme almak için (fork'un içinde):
#   git fetch upstream && git rebase upstream/main
# Iceni değişiklikleri tek commit halinde tutuluyor, çakışma yönetilebilir.

set -euo pipefail
cd "$(dirname "$0")/.."
THEME_DIR="$PWD"

FORK="${SLT_FORK:-$HOME/other-projects/slt-iceni}"
LOCK="vendor.lock"
OUT="extensions/spicy-lyric-translater.js"

[ -d "$FORK" ] || { echo "Fork bulunamadı: $FORK  (SLT_FORK ile yol verebilirsin)" >&2; exit 1; }

echo "Derleniyor: $FORK"
cd "$FORK"
[ -d node_modules ] || npm install --no-audit --no-fund
npm run build

SHA=$(shasum -a 256 dist/spicy-lyric-translater.js | awk '{print $1}')
VERSION=$(node -p "require('./package.json').version")
COMMIT=$(git rev-parse HEAD)
UPSTREAM=$(git rev-parse upstream/main 2>/dev/null || echo "unknown")

cd "$THEME_DIR"
{
  echo "// Iceni fork'undan derlendi — scripts/vendor-slt.sh ile üretildi."
  echo "// Kaynak: $FORK"
  echo "// Sürüm: $VERSION  commit: $COMMIT"
  echo "// ELLE DÜZENLEME. Değişiklik için fork'ta düzenle ve bu script'i çalıştır."
  cat "$FORK/dist/spicy-lyric-translater.js"
} > "$OUT"

touch "$LOCK"
grep -v '^slt\.' "$LOCK" > "$LOCK.tmp" || true
{
  cat "$LOCK.tmp"
  echo "slt.version=$VERSION"
  echo "slt.sha256=$SHA"
  echo "slt.fork-commit=$COMMIT"
  echo "slt.upstream-commit=$UPSTREAM"
  echo "slt.source=$FORK"
} | grep -v '^$' | sort > "$LOCK"
rm -f "$LOCK.tmp"

echo "OK  $OUT  ($(wc -c < "$OUT" | tr -d ' ') bayt)"
echo "Uygulamak için: spicetify apply"
