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

if [ ! -f "${STAGED_BIN}" ] || inputs_are_newer; then
  echo "Staging Everr CLI resource (${MODE})..."
  cargo build "${BUILD_ARGS[@]}"
  mkdir -p "$(dirname "${STAGED_BIN}")"
  cp "${BUILT_BIN}" "${STAGED_BIN}"
  chmod +x "${STAGED_BIN}"
else
  echo "Using existing staged Everr CLI resource (${MODE})."
fi
