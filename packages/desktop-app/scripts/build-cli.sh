#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: $0 <debug|release> [--install]" >&2
  exit 1
fi

MODE="$1"
INSTALL_BIN=0
if [ "${2:-}" = "--install" ]; then
  INSTALL_BIN=1
elif [ "${2:-}" != "" ]; then
  echo "Unsupported flag: ${2}" >&2
  exit 1
fi

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "${PACKAGE_DIR}/../.." && pwd)"
CLI_DIR="${PACKAGE_DIR}/src-cli"
PUBLIC_DIR="${REPO_DIR}/packages/docs/public"
INSTALL_PATH="${HOME}/.local/bin/everr"
ENV_FILE="${PACKAGE_DIR}/.env"

if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

sign_binary_if_needed() {
  local path="$1"

  if [ "$(uname -s)" != "Darwin" ]; then
    return 0
  fi

  if [ "${EVERR_ALLOW_UNSIGNED_MACOS_BUILD:-0}" = "1" ]; then
    echo "Skipping signing for ${path} because EVERR_ALLOW_UNSIGNED_MACOS_BUILD=1." >&2
    return 0
  fi

  if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
    echo "Skipping signing for ${path} because APPLE_SIGNING_IDENTITY is not set." >&2
    return 0
  fi

  if [ "${APPLE_SIGNING_IDENTITY}" = "-" ] || ! printf '%s\n' "${APPLE_SIGNING_IDENTITY}" | grep -q 'Developer ID Application:'; then
    echo "APPLE_SIGNING_IDENTITY must reference a Developer ID Application certificate to sign ${path}." >&2
    exit 1
  fi

  echo "Signing ${path} with ${APPLE_SIGNING_IDENTITY}..."
  codesign \
    --force \
    --sign "${APPLE_SIGNING_IDENTITY}" \
    --options runtime \
    --timestamp \
    "${path}"
}

case "${MODE}" in
  debug)
    BUILD_ARGS=(--manifest-path "${CLI_DIR}/Cargo.toml")
    BUILT_BIN="${REPO_DIR}/target/debug/everr"
    ;;
  release)
    BUILD_ARGS=(--release --manifest-path "${CLI_DIR}/Cargo.toml")
    BUILT_BIN="${REPO_DIR}/target/release/everr"
    ;;
  *)
    echo "Unsupported mode: ${MODE}" >&2
    exit 1
    ;;
esac

echo "Building everr CLI (${MODE})..."
cargo build "${BUILD_ARGS[@]}"

if [ "${MODE}" = "release" ]; then
  OUTPUT_BIN="${PUBLIC_DIR}/everr"
  OUTPUT_SHA="${PUBLIC_DIR}/everr.sha256"

  mkdir -p "${PUBLIC_DIR}"
  cp "${BUILT_BIN}" "${OUTPUT_BIN}"
  chmod +x "${OUTPUT_BIN}"

  sign_binary_if_needed "${OUTPUT_BIN}"

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${OUTPUT_BIN}" | awk '{print $1 "  everr"}' > "${OUTPUT_SHA}"
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${OUTPUT_BIN}" | awk '{print $1 "  everr"}' > "${OUTPUT_SHA}"
  else
    echo "Missing checksum tool: install shasum or sha256sum." >&2
    exit 1
  fi

  echo "Wrote ${OUTPUT_BIN}"
  echo "Wrote ${OUTPUT_SHA}"
fi

if [ "${INSTALL_BIN}" = "1" ]; then
  INSTALL_SOURCE="${BUILT_BIN}"
  if [ "${MODE}" = "release" ]; then
    INSTALL_SOURCE="${OUTPUT_BIN}"
  fi

  mkdir -p "$(dirname "${INSTALL_PATH}")"
  cp "${INSTALL_SOURCE}" "${INSTALL_PATH}"
  chmod +x "${INSTALL_PATH}"

  echo "Installed Everr CLI to ${INSTALL_PATH}"
fi

echo "Run 'everr --help' to get started."
