#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <debug|release>" >&2
  exit 1
fi

MODE="$1"
TARGET_TRIPLE="${TAURI_ENV_TARGET_TRIPLE:-}"
PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "${PACKAGE_DIR}/../.." && pwd)"
CLI_DIR="${PACKAGE_DIR}/src-cli"
BINARIES_DIR="${PACKAGE_DIR}/src-tauri/binaries"

if [ -z "${TARGET_TRIPLE}" ]; then
  TARGET_TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
fi

if [ -z "${TARGET_TRIPLE}" ]; then
  echo "Could not resolve target triple." >&2
  exit 1
fi

case "${MODE}" in
  debug)
    BUILD_ARGS=(--manifest-path "${CLI_DIR}/Cargo.toml")
    SOURCE_BIN="${REPO_DIR}/target/debug/everr"
    ;;
  release)
    BUILD_ARGS=(--release --manifest-path "${CLI_DIR}/Cargo.toml")
    SOURCE_BIN="${REPO_DIR}/target/release/everr"
    ;;
  *)
    echo "Unsupported mode: ${MODE}" >&2
    exit 1
    ;;
esac

DEST_BIN="${BINARIES_DIR}/everr-${TARGET_TRIPLE}"
if [[ "${TARGET_TRIPLE}" == *windows* ]]; then
  SOURCE_BIN="${SOURCE_BIN}.exe"
  DEST_BIN="${DEST_BIN}.exe"
fi

echo "Building Everr CLI sidecar (${MODE})..."
cargo build "${BUILD_ARGS[@]}"

mkdir -p "${BINARIES_DIR}"
cp "${SOURCE_BIN}" "${DEST_BIN}"

if [[ "${TARGET_TRIPLE}" != *windows* ]]; then
  chmod +x "${DEST_BIN}"
fi

echo "Prepared Tauri sidecar at ${DEST_BIN}"
