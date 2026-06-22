#!/bin/sh
set -eu

DOWNLOAD_BASE_URL="https://everr.dev/everr-app"
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
    line="export PATH=\"${INSTALL_DIR}:\$PATH\""
    case "$(basename "${SHELL:-sh}")" in
      zsh) rc="${ZDOTDIR:-$HOME}/.zshrc" ;;
      bash)
        if [ "${os}" = "Darwin" ]; then rc="${HOME}/.bash_profile"; else rc="${HOME}/.bashrc"; fi
        ;;
      fish)
        rc="${HOME}/.config/fish/config.fish"
        line="fish_add_path ${INSTALL_DIR}"
        ;;
      *) rc="${HOME}/.profile" ;;
    esac

    echo
    if [ -f "${rc}" ] && grep -qF "${INSTALL_DIR}" "${rc}" 2>/dev/null; then
      echo "  ${INSTALL_DIR} is already configured in ${rc} but not active in this shell."
      echo "  Restart your shell or run: ${line}"
    else
      mkdir -p "$(dirname "${rc}")"
      printf '\n# Added by Everr installer\n%s\n' "${line}" >> "${rc}"
      echo "  Added ${INSTALL_DIR} to your PATH in ${rc}"
      echo "  Restart your shell or run: ${line}"
    fi

    # Make everr available on PATH for the guided setup below.
    PATH="${INSTALL_DIR}:${PATH}"
    export PATH
    ;;
esac

# --- Guided setup ---
if [ -t 1 ]; then
  echo
  "${INSTALL_PATH}" setup </dev/tty
fi
