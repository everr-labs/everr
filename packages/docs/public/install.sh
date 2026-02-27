#!/usr/bin/env bash
set -euo pipefail

DOWNLOAD_BASE_URL="${EVERR_DOWNLOAD_BASE_URL:-https://everr.dev}"
BINARY_NAME="everr"
INSTALL_DIR="${HOME}/.local/bin"
INSTALL_PATH="${INSTALL_DIR}/everr"

os="$(uname -s)"
arch="$(uname -m)"

if [ "${os}" != "Darwin" ]; then
  echo "everr install script currently supports macOS only (detected: ${os})." >&2
  exit 1
fi

if [ "${arch}" != "arm64" ]; then
  echo "everr install script currently supports macOS arm64 only (detected: ${arch})." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

binary_url="${DOWNLOAD_BASE_URL%/}/${BINARY_NAME}"
checksum_url="${DOWNLOAD_BASE_URL%/}/${BINARY_NAME}.sha256"

echo "Downloading Everr CLI..."
curl -fsSL "${binary_url}" -o "${tmp_dir}/${BINARY_NAME}"
curl -fsSL "${checksum_url}" -o "${tmp_dir}/${BINARY_NAME}.sha256"

(
  cd "${tmp_dir}"
  shasum -a 256 -c "${BINARY_NAME}.sha256"
)

mkdir -p "${INSTALL_DIR}"
mv "${tmp_dir}/${BINARY_NAME}" "${INSTALL_PATH}"
chmod +x "${INSTALL_PATH}"

echo
echo "Everr CLI installed to ${INSTALL_PATH}"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    echo
    echo "Add ${INSTALL_DIR} to your PATH:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac

echo
echo "Starting Everr setup wizard..."
if [ -r /dev/tty ]; then
  "${INSTALL_PATH}" install </dev/tty
else
  echo "No interactive terminal available. Run manually:"
  echo "  everr install"
fi
