#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <debug|release>" >&2
  exit 1
fi

MODE="$1"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="${ROOT_DIR}/crates/everr-cli"
STAGED_BIN="${ROOT_DIR}/target/desktop-resources/everr"
MODE_FILE="${STAGED_BIN}.mode"
BUILT_BIN="${ROOT_DIR}/target/${MODE}/everr"

case "${MODE}" in
  debug)
    BUILD_ARGS=(--manifest-path "${CLI_DIR}/Cargo.toml")
    ;;
  release)
    BUILD_ARGS=(--release --manifest-path "${CLI_DIR}/Cargo.toml")
    ;;
  *)
    echo "Unsupported mode: ${MODE}" >&2
    exit 1
    ;;
esac

inputs_are_newer() {
  local file
  local dir
  local staged_mode=""

  if [ ! -f "${BUILT_BIN}" ]; then
    return 0
  fi

  if [ ! -f "${MODE_FILE}" ]; then
    return 0
  fi

  staged_mode="$(cat "${MODE_FILE}")"
  if [ "${staged_mode}" != "${MODE}" ]; then
    return 0
  fi

  if [ "${BUILT_BIN}" -nt "${STAGED_BIN}" ]; then
    return 0
  fi

  for file in \
    "${CLI_DIR}/Cargo.toml" \
    "${CLI_DIR}/build.rs" \
    "${ROOT_DIR}/Cargo.lock"
  do
    if [ "${file}" -nt "${STAGED_BIN}" ]; then
      return 0
    fi
  done

  for dir in \
    "${CLI_DIR}/src" \
    "${CLI_DIR}/assets" \
    "${ROOT_DIR}/crates/everr-core/src"
  do
    if [ -d "${dir}" ] && find "${dir}" -type f -newer "${STAGED_BIN}" -print -quit | grep -q .; then
      return 0
    fi
  done

  return 1
}

sign_staged_bin_if_needed() {
  if [ "${MODE}" != "release" ] || [ "$(uname -s)" != "Darwin" ]; then
    return 0
  fi

  if [ "${EVERR_ALLOW_UNSIGNED_MACOS_BUILD:-0}" = "1" ]; then
    echo "Skipping Everr CLI resource signing because EVERR_ALLOW_UNSIGNED_MACOS_BUILD=1." >&2
    return 0
  fi

  if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
    echo "Skipping Everr CLI resource signing because APPLE_SIGNING_IDENTITY is not set." >&2
    return 0
  fi

  if [ "${APPLE_SIGNING_IDENTITY}" = "-" ] || ! printf '%s\n' "${APPLE_SIGNING_IDENTITY}" | grep -q 'Developer ID Application:'; then
    echo "APPLE_SIGNING_IDENTITY must reference a Developer ID Application certificate to sign the bundled Everr CLI resource." >&2
    exit 1
  fi

  echo "Signing staged Everr CLI resource with ${APPLE_SIGNING_IDENTITY}..."
  codesign \
    --force \
    --sign "${APPLE_SIGNING_IDENTITY}" \
    --options runtime \
    --timestamp \
    "${STAGED_BIN}"
}

if [ ! -f "${STAGED_BIN}" ] || inputs_are_newer; then
  echo "Staging Everr CLI resource (${MODE})..."
  cargo build "${BUILD_ARGS[@]}"
  mkdir -p "$(dirname "${STAGED_BIN}")"
  cp "${BUILT_BIN}" "${STAGED_BIN}"
  chmod +x "${STAGED_BIN}"
  printf '%s\n' "${MODE}" > "${MODE_FILE}"
else
  echo "Using existing staged Everr CLI resource (${MODE})."
fi

sign_staged_bin_if_needed
