#!/usr/bin/env bash
# Build calibre and collect the result in releases/<version>-<git hash>/.
#   scripts/build.sh            fast: just the optimized binary (good for testing each build)
#   scripts/build.sh --bundle   also make installers for this OS (deb/rpm/AppImage, dmg, msi...)
set -euo pipefail
cd "$(dirname "$0")/.."

version="$(node -p "require('./package.json').version")"
hash="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
git diff --quiet 2>/dev/null || hash="$hash-dirty"
out="releases/$version-$hash"

npm install --no-audit --no-fund
if [[ "${1:-}" == "--bundle" ]]; then
    npm run tauri build
else
    npm run tauri build -- --no-bundle
fi

mkdir -p "$out"
bin="src-tauri/target/release/calibre"
[[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]] && bin="$bin.exe"
cp "$bin" "$out/"
[[ -d src-tauri/target/release/bundle ]] && cp -r src-tauri/target/release/bundle "$out/"
echo
echo "Built: $out"
ls -1 "$out"
