#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/packages/everr-app"
PUBLIC_DIR="${ROOT_DIR}/packages/docs/public"
ROOT_BUNDLE_DIR="${ROOT_DIR}/target/release/bundle"
APP_BUNDLE_DIR="${APP_DIR}/src-tauri/target/release/bundle"
ENV_FILE="${ROOT_DIR}/.env"
VERIFY_MACOS_SCRIPT="${ROOT_DIR}/scripts/verify-everr-app-macos.sh"
ARTIFACT_PREFIX="everr-app"

load_root_env() {
  if [ ! -f "${ENV_FILE}" ]; then
    echo "Missing ${ENV_FILE}. Add the Apple signing and notarization variables there before building." >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
}

require_env_var() {
  local name="$1"

  if [ -z "${!name:-}" ]; then
    echo "Missing ${name} in ${ENV_FILE}." >&2
    exit 1
  fi
}

find_release_artifact() {
  local bundle_dir="$1"
  local target_platform="$2"

  case "${target_platform}" in
    macos)
      find "${bundle_dir}" -type f -name '*.dmg' | sort | head -n 1
      ;;
    linux)
      find "${bundle_dir}" -type f \( -name '*.AppImage' -o -name '*.deb' -o -name '*.rpm' \) | sort | head -n 1
      ;;
    windows)
      find "${bundle_dir}" -type f \( -name '*.msi' -o -name '*.exe' \) | sort | head -n 1
      ;;
    *)
      return 1
      ;;
  esac
}

setup_macos_signing() {
  if [ "$(uname -s)" != "Darwin" ]; then
    return 0
  fi

  load_root_env

  if [ "${EVERR_ALLOW_UNSIGNED_MACOS_BUILD:-0}" != "1" ]; then
    require_env_var "APPLE_SIGNING_IDENTITY"
    require_env_var "APPLE_ID"
    require_env_var "APPLE_PASSWORD"
    require_env_var "APPLE_TEAM_ID"

    if [ "${APPLE_SIGNING_IDENTITY}" = "-" ] || ! printf '%s\n' "${APPLE_SIGNING_IDENTITY}" | grep -q 'Developer ID Application:'; then
      echo "APPLE_SIGNING_IDENTITY must reference a Developer ID Application certificate for a distributable macOS build." >&2
      exit 1
    fi
  fi
}

cd "${APP_DIR}"
rm -rf "${ROOT_BUNDLE_DIR}" "${APP_BUNDLE_DIR}"
setup_macos_signing
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
DEST_DIR="${PUBLIC_DIR}/everr-app"
artifact_source="$(find_release_artifact "${BUNDLE_DIR}" "${platform}")"

if [ -z "${artifact_source}" ]; then
  echo "Could not locate a release artifact for ${platform}-${arch}." >&2
  exit 1
fi

artifact_extension=".${artifact_source##*.}"
artifact_path="${DEST_DIR}/${ARTIFACT_PREFIX}-${platform}-${arch}${artifact_extension}"

mkdir -p "${DEST_DIR}"
rm -f "${DEST_DIR}/${ARTIFACT_PREFIX}-${platform}-${arch}".*
rm -rf "${DEST_DIR}/${platform}-${arch}" "${DEST_DIR}/darwin-${arch}"
cp "${artifact_source}" "${artifact_path}"

if [ -x "${artifact_source}" ]; then
  chmod +x "${artifact_path}"
fi

if [ "${platform}" = "macos" ]; then
  if [ "${EVERR_ALLOW_UNSIGNED_MACOS_BUILD:-0}" != "1" ]; then
    "${VERIFY_MACOS_SCRIPT}" "${artifact_path}"
  else
    echo "Skipping macOS signing verification because EVERR_ALLOW_UNSIGNED_MACOS_BUILD=1" >&2
  fi
fi

echo "Copied Everr App release artifact to ${artifact_path}"
