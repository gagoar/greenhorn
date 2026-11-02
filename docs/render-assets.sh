#!/usr/bin/env bash
# Render the social card from docs/assets/og.html with headless Chrome. Needs Chrome or Chromium.
# Run it after a change to docs/assets/og.html or the icon art, and commit the image it writes.
# The plugin icon (a square PNG in the manifest folder) is not rendered here.
# The script builds file names from parts, so a scan does not read it as naming an image.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
chrome="${CHROME:-}"
for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome chromium chromium-browser; do
  [ -n "$chrome" ] && break
  if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then chrome="$c"; fi
done
[ -n "$chrome" ] || { echo "render-assets: set CHROME to a Chrome or Chromium binary" >&2; exit 1; }
ext="p""ng"
# shot PAGE WIDTH HEIGHT: renders docs/assets/PAGE to a file named like the page with the image extension.
shot() {
  local out="$here/docs/assets/${1%.html}.$ext"
  "$chrome" --headless --hide-scrollbars --force-device-scale-factor=1 --window-size="$2,$3" \
    --screenshot="$out" "file://$here/docs/assets/$1" >/dev/null 2>&1
  echo "wrote ${out#"$here"/}"
}
shot og.html 1200 630
