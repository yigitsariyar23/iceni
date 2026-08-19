#!/usr/bin/env bash
# Spicy Lyrics'i belirli bir sürüme sabitleyip extensions/ altına indirir.
#
# Neden: upstream'in kendi yükleyicisi iki kademeli uzaktan yükleme yapar
#   builds/spicy-lyrics.mjs -> jsDelivr @main -> api.spicylyrics.org/version
#   -> public.storage.spicylyrics.org/spicy-lyrics@<son sürüm>.mjs
# Yani çalışan kod hiçbir zaman pinli değildir. Bu script kodu diske alır;
# sürüm ancak sen bu script'i tekrar çalıştırınca değişir.
#
# Kullanım:
#   ./scripts/vendor-spicy-lyrics.sh          # vendor.lock'taki sürümü kurar
#   ./scripts/vendor-spicy-lyrics.sh 6.3.1    # belirtilen sürüme geçer
#   ./scripts/vendor-spicy-lyrics.sh --latest # upstream'in son sürümüne geçer

set -euo pipefail
cd "$(dirname "$0")/.."

LOCK="vendor.lock"
OUT="extensions/spicy-lyrics.js"
STORAGE="https://public.storage.spicylyrics.org"

case "${1-}" in
  --latest) VERSION=$(curl -fsS --max-time 20 https://api.spicylyrics.org/version) ;;
  "")       VERSION=$(awk -F= '/^spicy-lyrics.version=/{print $2}' "$LOCK") ;;
  *)        VERSION="$1" ;;
esac

[ -n "$VERSION" ] || { echo "Sürüm belirlenemedi." >&2; exit 1; }
echo "Spicy Lyrics $VERSION indiriliyor..."

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
curl -fsS --max-time 120 -o "$TMP" "$STORAGE/spicy-lyrics%40${VERSION}.mjs"

# Bundle IIFE; ESM değil. Klasik <script> olarak yüklenebiliyor, bu yüzden
# ayrı bir loader'a gerek yok. Tek gereken sürüm metadata'sının önceden
# tanımlı olması (bundle window._spicy_lyrics_metadata.LoadedVersion okuyor).
if grep -qE '^\s*(import|export)[ {*]' "$TMP"; then
  echo "UYARI: bundle ESM sözdizimi içeriyor, klasik script olarak yüklenmeyebilir." >&2
fi

SHA=$(shasum -a 256 "$TMP" | awk '{print $1}')

{
  echo "// Iceni tarafından pinlendi — scripts/vendor-spicy-lyrics.sh ile üretildi."
  echo "// Kaynak: $STORAGE/spicy-lyrics%40${VERSION}.mjs"
  echo "// Sürüm: $VERSION  sha256: $SHA"
  echo "// ELLE DÜZENLEME. Sürüm değiştirmek için script'i çalıştır."
  echo "window._spicy_lyrics_metadata = { LoadedVersion: \"${VERSION}\" };"
  cat "$TMP"
} > "$OUT"

# vendor.lock güncelle
touch "$LOCK"
grep -v '^spicy-lyrics\.' "$LOCK" > "$LOCK.tmp" || true
{
  cat "$LOCK.tmp"
  echo "spicy-lyrics.version=$VERSION"
  echo "spicy-lyrics.sha256=$SHA"
  echo "spicy-lyrics.source=$STORAGE/spicy-lyrics%40${VERSION}.mjs"
} | grep -v '^$' | sort > "$LOCK"
rm -f "$LOCK.tmp"

echo "OK  $OUT  ($(wc -c < "$OUT" | tr -d ' ') bayt)"
echo "    sürüm $VERSION  sha256 ${SHA:0:16}..."
echo "Uygulamak için: spicetify apply"
