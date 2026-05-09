#!/usr/bin/env bash
set -euo pipefail

DOWNLOAD_BASE_URL="https://everr.dev/everr-app"
INSTALL_DIR="${HOME}/.local/bin"
INSTALL_PATH="${INSTALL_DIR}/everr"

detect_target() {
  local os="$1"
  local arch="$2"

  case "${os}" in
    Darwin)
      case "${arch}" in
        arm64|aarch64) printf '%s\n' "macos-arm64" ;;
        *)
          echo "everr install script unsupported architecture for macOS: ${arch}." >&2
          return 1
          ;;
      esac
      ;;
    Linux)
      case "${arch}" in
        x86_64|amd64) printf '%s\n' "linux-x64" ;;
        aarch64|arm64) printf '%s\n' "linux-arm64" ;;
        *)
          echo "everr install script unsupported architecture for Linux: ${arch}." >&2
          return 1
          ;;
      esac
      ;;
    *)
      echo "everr install script unsupported operating system: ${os}." >&2
      return 1
      ;;
  esac
}

verify_checksum() {
  local checksum_file="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "${checksum_file}" > /dev/null
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c "${checksum_file}" > /dev/null
    return
  fi

  echo "everr install script needs sha256sum or shasum to verify the download." >&2
  return 1
}

target="$(detect_target "$(uname -s)" "$(uname -m)")"
binary_name="everr-${target}"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

binary_url="${DOWNLOAD_BASE_URL%/}/${binary_name}"
checksum_url="${DOWNLOAD_BASE_URL%/}/${binary_name}.sha256"

echo "Downloading Everr CLI..."
curl -fsSL "${binary_url}" -o "${tmp_dir}/${binary_name}"
curl -fsSL "${checksum_url}" -o "${tmp_dir}/${binary_name}.sha256"

(
  cd "${tmp_dir}"
  verify_checksum "${binary_name}.sha256"
)

mkdir -p "${INSTALL_DIR}"
mv "${tmp_dir}/${binary_name}" "${INSTALL_PATH}"
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
