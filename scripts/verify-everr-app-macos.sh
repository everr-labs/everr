#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: $0 <path-to-dmg>" >&2
  exit 1
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This verification script only runs on macOS." >&2
  exit 1
fi

DMG_PATH="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
APP_NAME="${EVERR_APP_NAME:-Everr App.app}"

if [ ! -f "${DMG_PATH}" ]; then
  echo "DMG not found: ${DMG_PATH}" >&2
  exit 1
fi

for tool in codesign hdiutil spctl xcrun; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "Missing required tool: ${tool}" >&2
    exit 1
  fi
done

find_existing_mount() {
  hdiutil info | awk -v dmg="${DMG_PATH}" '
    /^image-path[[:space:]]*:/ {
      current=$0
      sub(/^image-path[[:space:]]*:[[:space:]]*/, "", current)
      next
    }
    /^\/dev\// && current==dmg && NF >= 3 {
      mount=$3
      for (i = 4; i <= NF; i++) {
        mount = mount " " $i
      }
      print mount
      exit
    }
  '
}

MOUNT_POINT=""
DID_ATTACH=0

cleanup() {
  if [ "${DID_ATTACH}" = "1" ] && mount | grep -Fq "on ${MOUNT_POINT} "; then
    hdiutil detach "${MOUNT_POINT}" -quiet || true
  fi
  if [ "${DID_ATTACH}" = "1" ]; then
    rmdir "${MOUNT_POINT}" 2>/dev/null || true
  fi
}

trap cleanup EXIT

MOUNT_POINT="$(find_existing_mount)"
if [ -z "${MOUNT_POINT}" ]; then
  MOUNT_POINT="$(mktemp -d "${TMPDIR:-/tmp}/everr-app.XXXXXX")"
  hdiutil attach -nobrowse -readonly -mountpoint "${MOUNT_POINT}" "${DMG_PATH}" >/dev/null
  DID_ATTACH=1
fi

APP_PATH="$(find "${MOUNT_POINT}" -maxdepth 2 -type d -name "${APP_NAME}" -print -quit)"
if [ -z "${APP_PATH}" ]; then
  echo "Could not locate ${APP_NAME} inside ${DMG_PATH}" >&2
  exit 1
fi

SIGNATURE_DETAILS="$(codesign -dv --verbose=4 "${APP_PATH}" 2>&1 || true)"

if printf '%s\n' "${SIGNATURE_DETAILS}" | grep -q 'Signature=adhoc'; then
  echo "The bundled app is ad-hoc signed. Build with a Developer ID certificate before publishing." >&2
  exit 1
fi

if printf '%s\n' "${SIGNATURE_DETAILS}" | grep -q 'TeamIdentifier=not set'; then
  echo "The bundled app has no Apple team identifier. Build with a valid Apple signing identity before publishing." >&2
  exit 1
fi

if ! codesign --verify --deep --strict --verbose=2 "${APP_PATH}" >/dev/null 2>&1; then
  echo "The bundled app failed codesign verification." >&2
  echo "${SIGNATURE_DETAILS}" >&2
  exit 1
fi

if ! xcrun stapler validate "${DMG_PATH}" >/dev/null 2>&1; then
  echo "The DMG is not stapled. Notarize and staple it before publishing." >&2
  exit 1
fi

if ! spctl -a -t open --context context:primary-signature -vv "${DMG_PATH}" >/dev/null 2>&1; then
  echo "Gatekeeper rejected the DMG signature." >&2
  exit 1
fi

echo "Verified macOS release artifact: ${DMG_PATH}"
