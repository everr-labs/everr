#!/usr/bin/env bash
set -euo pipefail

DOWNLOAD_BASE_URL="http://localhost:3000/everr-app"
INSTALL_DIR="${HOME}/.local/bin"
INSTALL_PATH="${INSTALL_DIR}/everr"

os="$(uname -s)"
arch="$(uname -m)"

case "${os}:${arch}" in
  Darwin:arm64)
    BINARY_NAME="everr"
    ;;
  Linux:aarch64|Linux:arm64)
    BINARY_NAME="everr-linux-arm64"
    ;;
  Linux:x86_64|Linux:amd64)
    BINARY_NAME="everr-linux-x86_64"
    ;;
  *)
    echo "everr install script does not support ${os} ${arch}." >&2
    exit 1
    ;;
esac

CHECKSUM_NAME="${BINARY_NAME}.sha256"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

binary_url="${DOWNLOAD_BASE_URL%/}/${BINARY_NAME}"
checksum_url="${DOWNLOAD_BASE_URL%/}/${CHECKSUM_NAME}"

echo "Downloading Everr CLI..."
curl -fsSL "${binary_url}" -o "${tmp_dir}/${BINARY_NAME}"
curl -fsSL "${checksum_url}" -o "${tmp_dir}/${CHECKSUM_NAME}"

(
  cd "${tmp_dir}"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c "${CHECKSUM_NAME}" > /dev/null
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "${CHECKSUM_NAME}" > /dev/null
  else
    echo "No SHA-256 checksum tool found. Install shasum or sha256sum." >&2
    exit 1
  fi
)

mkdir -p "${INSTALL_DIR}"
mv "${tmp_dir}/${BINARY_NAME}" "${INSTALL_PATH}"
chmod +x "${INSTALL_PATH}"

echo "  Installed to ${INSTALL_PATH}"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    echo
    echo "  Add ${INSTALL_DIR} to your PATH:"
    echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac

# --- Guided setup ---
if [ -t 1 ]; then
  echo
  "${INSTALL_PATH}" setup </dev/tty
fi
