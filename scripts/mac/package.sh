#!/usr/bin/env bash
# Package Strata Code as a macOS .app (Apple Silicon) with @electron/packager.
# Output: release/Strata Code-darwin-arm64/Strata Code.app (+ a zip next to it).
# The coder model and llama-server are NOT bundled: the app finds Homebrew's
# llama-server and the models under ~/Library/Application Support/Strata/code
# (scripts/mac/setup.sh). Unsigned: first launch needs right-click > Open.
set -euo pipefail
cd "$(dirname "$0")/../.."
ARCH="${1:-arm64}"

npm run build

# .icns from the 256 px PNG with the system tools (no extra dependency).
ICONSET="$(mktemp -d)/strata.iconset"; mkdir -p "$ICONSET"
for s in 16 32 64 128 256; do
  sips -z $s $s assets/strata-code-sc-256.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s*2)); [ $d -le 512 ] && sips -z $d $d assets/strata-code-sc-256.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o assets/strata-code.icns

npx @electron/packager . "Strata Code" \
  --platform=darwin --arch="$ARCH" --out=release --overwrite \
  --icon=assets/strata-code.icns \
  --app-bundle-id=com.kaustubhjawanjal.stratacode \
  --ignore='^/(release|installer|scratchpad|.*\.ps1|.*\.bat|.*\.vbs)' \
  --extra-resource=EULA.md

cd release && ditto -c -k --keepParent "Strata Code-darwin-$ARCH/Strata Code.app" "Strata-Code-macOS-$ARCH.zip"
shasum -a 256 "Strata-Code-macOS-$ARCH.zip" > "Strata-Code-macOS-$ARCH.zip.sha256"
echo "Packaged: release/Strata-Code-macOS-$ARCH.zip"
