#!/usr/bin/env bash
# Build calibre and install it for the current user (Linux):
#   ~/.local/bin/calibre, a desktop entry (shows up in launchers), and the icon.
# Re-run it after each change to test the new build.   Use --no-build to just reinstall.
set -euo pipefail
cd "$(dirname "$0")/.."

[[ "${1:-}" == "--no-build" ]] || scripts/build.sh

bin="src-tauri/target/release/calibre"
[[ -x "$bin" ]] || { echo "no binary at $bin - run scripts/build.sh first" >&2; exit 1; }

prefix="${PREFIX:-$HOME/.local}"
install -Dm755 "$bin" "$prefix/bin/calibre"
install -Dm644 src-tauri/icons/128x128.png "$prefix/share/icons/hicolor/128x128/apps/calibre.png"
install -Dm644 packaging/calibre.desktop "$prefix/share/applications/calibre.desktop"
command -v update-desktop-database >/dev/null && update-desktop-database "$prefix/share/applications" 2>/dev/null || true

echo "Installed: $prefix/bin/calibre"
echo "Launch it from your app launcher, or run: calibre"
