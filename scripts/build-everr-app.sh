#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/packages/everr-app"
PUBLIC_DIR="${ROOT_DIR}/packages/docs/public"
ROOT_BUNDLE_DIR="${ROOT_DIR}/target/release/bundle"
APP_BUNDLE_DIR="${APP_DIR}/src-tauri/target/release/bundle"

cd "${APP_DIR}"
rm -rf "${ROOT_BUNDLE_DIR}" "${APP_BUNDLE_DIR}"
pnpm tauri build

BUNDLE_DIR="${ROOT_BUNDLE_DIR}"
if [ ! -d "${BUNDLE_DIR}" ]; then
  BUNDLE_DIR="${APP_BUNDLE_DIR}"
fi

if [ ! -d "${BUNDLE_DIR}" ]; then
  echo "Could not locate the Tauri release bundle directory." >&2
  exit 1
fi

os="$(uname -s)"
case "${os}" in
  Darwin) platform="macos" ;;
  Linux) platform="linux" ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT) platform="windows" ;;
  *) platform="$(printf '%s' "${os}" | tr '[:upper:]' '[:lower:]')" ;;
esac

arch="$(uname -m | tr '[:upper:]' '[:lower:]')"
DEST_DIR="${PUBLIC_DIR}/everr-app/${platform}-${arch}"

rm -rf "${DEST_DIR}"
mkdir -p "${DEST_DIR}"
cp -R "${BUNDLE_DIR}/." "${DEST_DIR}/"

if [ "${platform}" = "macos" ]; then
  dmg_source="$(find "${DEST_DIR}" -type f -name '*.dmg' | head -n 1)"

  if [ -z "${dmg_source}" ]; then
    echo "Could not locate the Tauri DMG bundle." >&2
    exit 1
  fi

  cp "${dmg_source}" "${DEST_DIR}/Everr App.dmg"
fi

echo "Copied Everr App release bundles to ${DEST_DIR}"
