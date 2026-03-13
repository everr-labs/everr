#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/packages/everr-app"
PUBLIC_DIR="${ROOT_DIR}/packages/docs/public"
ROOT_BUNDLE_DIR="${ROOT_DIR}/target/release/bundle"
APP_BUNDLE_DIR="${APP_DIR}/src-tauri/target/release/bundle"
ENV_FILE="${ROOT_DIR}/.env"
VERIFY_MACOS_SCRIPT="${ROOT_DIR}/scripts/verify-everr-app-macos.sh"
TEMP_SIGNING_DIR=""
TEMP_KEYCHAIN=""
KEYCHAIN_WAS_CREATED=0
ORIGINAL_DEFAULT_KEYCHAIN=""
ORIGINAL_KEYCHAINS=()

current_default_keychain() {
  security default-keychain -d user | sed 's/^[[:space:]]*//; s/^"//; s/"$//'
}

current_keychain_list() {
  security list-keychains -d user | sed 's/^[[:space:]]*//; s/^"//; s/"$//'
}

load_current_keychains() {
  ORIGINAL_KEYCHAINS=()

  while IFS= read -r keychain; do
    if [ -n "${keychain}" ]; then
      ORIGINAL_KEYCHAINS+=("${keychain}")
    fi
  done < <(current_keychain_list)
}

decode_base64_to_file() {
  local value="$1"
  local output_path="$2"

  if printf '%s' "${value}" | base64 --decode >"${output_path}" 2>/dev/null; then
    return 0
  fi

  if printf '%s' "${value}" | base64 -D >"${output_path}" 2>/dev/null; then
    return 0
  fi

  echo "Failed to decode base64 content." >&2
  exit 1
}

ensure_temp_signing_dir() {
  if [ -z "${TEMP_SIGNING_DIR}" ]; then
    TEMP_SIGNING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/everr-signing.XXXXXX")"
  fi
}

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

require_notarization_credentials() {
  if [ -n "${APPLE_ID:-}" ] || [ -n "${APPLE_PASSWORD:-}" ] || [ -n "${APPLE_TEAM_ID:-}" ]; then
    require_env_var "APPLE_ID"
    require_env_var "APPLE_PASSWORD"
    require_env_var "APPLE_TEAM_ID"
    return 0
  fi

  if [ -n "${APPLE_API_KEY:-}" ] || [ -n "${APPLE_API_ISSUER:-}" ] || [ -n "${APPLE_API_KEY_PATH:-}" ] || [ -n "${APPLE_API_PRIVATE_KEY:-}" ]; then
    require_env_var "APPLE_API_KEY"
    require_env_var "APPLE_API_ISSUER"

    if [ -z "${APPLE_API_KEY_PATH:-}" ] && [ -z "${APPLE_API_PRIVATE_KEY:-}" ]; then
      echo "Missing APPLE_API_KEY_PATH or APPLE_API_PRIVATE_KEY in ${ENV_FILE}." >&2
      exit 1
    fi

    return 0
  fi

  echo "Missing notarization credentials in ${ENV_FILE}. Set APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID or APPLE_API_KEY/APPLE_API_ISSUER with APPLE_API_KEY_PATH or APPLE_API_PRIVATE_KEY." >&2
  exit 1
}

cleanup_macos_signing() {
  if [ "${KEYCHAIN_WAS_CREATED}" = "1" ]; then
    if [ "${#ORIGINAL_KEYCHAINS[@]}" -gt 0 ]; then
      security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}" >/dev/null 2>&1 || true
    fi

    if [ -n "${ORIGINAL_DEFAULT_KEYCHAIN}" ]; then
      security default-keychain -d user -s "${ORIGINAL_DEFAULT_KEYCHAIN}" >/dev/null 2>&1 || true
    fi

    if [ -n "${TEMP_KEYCHAIN}" ]; then
      security delete-keychain "${TEMP_KEYCHAIN}" >/dev/null 2>&1 || true
    fi
  fi

  if [ -n "${TEMP_SIGNING_DIR}" ]; then
    rm -rf "${TEMP_SIGNING_DIR}"
  fi
}

setup_macos_signing() {
  if [ "$(uname -s)" != "Darwin" ]; then
    return 0
  fi

  load_root_env

  if [ -n "${APPLE_API_PRIVATE_KEY:-}" ]; then
    require_env_var "APPLE_API_KEY"

    if [ -z "${APPLE_API_KEY_PATH:-}" ]; then
      ensure_temp_signing_dir
      APPLE_API_KEY_PATH="${TEMP_SIGNING_DIR}/AuthKey_${APPLE_API_KEY}.p8"
      printf '%s' "${APPLE_API_PRIVATE_KEY}" >"${APPLE_API_KEY_PATH}"
      chmod 600 "${APPLE_API_KEY_PATH}"
      export APPLE_API_KEY_PATH
    fi
  fi

  if [ -n "${APPLE_CERTIFICATE:-}" ]; then
    require_env_var "APPLE_CERTIFICATE_PASSWORD"

    ensure_temp_signing_dir
    TEMP_KEYCHAIN="${TEMP_SIGNING_DIR}/everr-signing.keychain-db"
    ORIGINAL_DEFAULT_KEYCHAIN="$(current_default_keychain)"
    load_current_keychains

    decode_base64_to_file "${APPLE_CERTIFICATE}" "${TEMP_SIGNING_DIR}/certificate.p12"

    KEYCHAIN_PASSWORD="${KEYCHAIN_PASSWORD:-$(openssl rand -base64 24)}"
    export KEYCHAIN_PASSWORD

    security create-keychain -p "${KEYCHAIN_PASSWORD}" "${TEMP_KEYCHAIN}" >/dev/null
    security set-keychain-settings -lut 3600 "${TEMP_KEYCHAIN}" >/dev/null
    security unlock-keychain -p "${KEYCHAIN_PASSWORD}" "${TEMP_KEYCHAIN}" >/dev/null
    security import "${TEMP_SIGNING_DIR}/certificate.p12" \
      -k "${TEMP_KEYCHAIN}" \
      -P "${APPLE_CERTIFICATE_PASSWORD}" \
      -T /usr/bin/codesign \
      -T /usr/bin/security >/dev/null
    security set-key-partition-list \
      -S apple-tool:,apple:,codesign: \
      -s \
      -k "${KEYCHAIN_PASSWORD}" \
      "${TEMP_KEYCHAIN}" >/dev/null

    if [ "${#ORIGINAL_KEYCHAINS[@]}" -gt 0 ]; then
      security list-keychains -d user -s "${TEMP_KEYCHAIN}" "${ORIGINAL_KEYCHAINS[@]}" >/dev/null
    else
      security list-keychains -d user -s "${TEMP_KEYCHAIN}" >/dev/null
    fi

    security default-keychain -d user -s "${TEMP_KEYCHAIN}" >/dev/null
    KEYCHAIN_WAS_CREATED=1
  fi

  if [ "${EVERR_ALLOW_UNSIGNED_MACOS_BUILD:-0}" != "1" ]; then
    require_env_var "APPLE_SIGNING_IDENTITY"

    if [ "${APPLE_SIGNING_IDENTITY}" = "-" ] || ! printf '%s\n' "${APPLE_SIGNING_IDENTITY}" | grep -q 'Developer ID Application:'; then
      echo "APPLE_SIGNING_IDENTITY must reference a Developer ID Application certificate for a distributable macOS build." >&2
      exit 1
    fi

    require_notarization_credentials
  fi
}

trap cleanup_macos_signing EXIT

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
DEST_DIR="${PUBLIC_DIR}/everr-app/${platform}-${arch}"

rm -rf "${DEST_DIR}"
mkdir -p "${DEST_DIR}"
cp -R "${BUNDLE_DIR}/." "${DEST_DIR}/"

if [ "${platform}" = "macos" ]; then
  dmg_source="$(find "${DEST_DIR}" -type f -name '*.dmg' | head -n 1)"
  canonical_dmg="${DEST_DIR}/Everr App.dmg"
  legacy_dest_dir="${PUBLIC_DIR}/everr-app/darwin-${arch}"

  if [ -z "${dmg_source}" ]; then
    echo "Could not locate the Tauri DMG bundle." >&2
    exit 1
  fi

  cp "${dmg_source}" "${canonical_dmg}"

  if [ "${EVERR_ALLOW_UNSIGNED_MACOS_BUILD:-0}" != "1" ]; then
    "${VERIFY_MACOS_SCRIPT}" "${canonical_dmg}"
  else
    echo "Skipping macOS signing verification because EVERR_ALLOW_UNSIGNED_MACOS_BUILD=1" >&2
  fi

  rm -rf "${legacy_dest_dir}"
  mkdir -p "${legacy_dest_dir}"
  cp -R "${DEST_DIR}/." "${legacy_dest_dir}/"
fi

echo "Copied Everr App release bundles to ${DEST_DIR}"
