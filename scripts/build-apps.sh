#!/usr/bin/env bash
# Builds every custom app under apps/ into its dist/, which is what
# install.sh links into spicetify's CustomApps directory.
#
# The build output is deliberately not in git: it is reproducible from the
# TypeScript source next to it, and a minified bundle makes for an unreadable
# diff on every change.

set -euo pipefail
cd "$(dirname "$0")/.."

command -v node >/dev/null || { echo "node not found in PATH" >&2; exit 1; }

for dir in apps/*/; do
  [ -f "$dir/package.json" ] || continue
  name=$(basename "$dir")
  echo "== $name"
  (
    cd "$dir"
    [ -d node_modules ] || npm install --no-audit --no-fund
    npm run --silent typecheck
    npm run --silent build
  )
done

echo
echo "Built. To install and apply:"
echo "  ./install.sh && spicetify apply"
