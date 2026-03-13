#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/packages/everr-app"
PUBLIC_DIR="${ROOT_DIR}/packages/docs/public"
ROOT_BUNDLE_DIR="${ROOT_DIR}/target/release/bundle"
APP_BUNDLE_DIR="${APP_DIR}/src-tauri/target/release/bundle"
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

find_developer_id_identity() {
  local identities=""

  if [ "${1:-}" = "" ]; then
    identities="$(security find-identity -v -p codesigning 2>/dev/null || true)"
  else
    identities="$(security find-identity -v -p codesigning "$1" 2>/dev/null || true)"
  fi

  printf '%s\n' "${identities}" \
    | sed -n 's/.*"\(.*\)".*/\1/p' \
    | grep 'Developer ID Application:' \
    | head -n 1
}

ensure_temp_signing_dir() {
  if [ -z "${TEMP_SIGNING_DIR}" ]; then
    TEMP_SIGNING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/everr-signing.XXXXXX")"
  fi
}

resolve_api_key_path() {
  if [ -z "${APPLE_API_KEY:-}" ]; then
    return 1
  fi

  local candidate=""
  local search_dir=""
  local search_dirs=(
    "${APP_DIR}/private_keys"
    "${HOME}/private_keys"
    "${HOME}/.private_keys"
    "${HOME}/.appstoreconnect/private_keys"
  )

  if [ -n "${API_PRIVATE_KEYS_DIR:-}" ]; then
    candidate="${API_PRIVATE_KEYS_DIR}/AuthKey_${APPLE_API_KEY}.p8"
    if [ -f "${candidate}" ]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  fi

  for search_dir in "${search_dirs[@]}"; do
    candidate="${search_dir}/AuthKey_${APPLE_API_KEY}.p8"
    if [ -f "${candidate}" ]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  return 1
}

have_notarization_credentials() {
  if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    return 0
  fi

  if [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]; then
    return 0
  fi

  return 1
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

  if [ -n "${APPLE_API_PRIVATE_KEY:-}" ]; then
    if [ -z "${APPLE_API_KEY:-}" ]; then
      echo "APPLE_API_KEY is required when APPLE_API_PRIVATE_KEY is set." >&2
      exit 1
    fi

    if [ -z "${APPLE_API_KEY_PATH:-}" ]; then
      ensure_temp_signing_dir
      APPLE_API_KEY_PATH="${TEMP_SIGNING_DIR}/AuthKey_${APPLE_API_KEY}.p8"
      printf '%s' "${APPLE_API_PRIVATE_KEY}" >"${APPLE_API_KEY_PATH}"
      chmod 600 "${APPLE_API_KEY_PATH}"
      export APPLE_API_KEY_PATH
    fi
  elif [ -z "${APPLE_API_KEY_PATH:-}" ] && [ -n "${APPLE_API_KEY:-}" ]; then
    APPLE_API_KEY_PATH="$(resolve_api_key_path || true)"
    if [ -n "${APPLE_API_KEY_PATH}" ]; then
      export APPLE_API_KEY_PATH
    fi
  fi

  if [ -n "${APPLE_CERTIFICATE:-}" ]; then
    if [ -z "${APPLE_CERTIFICATE_PASSWORD:-}" ]; then
      echo "APPLE_CERTIFICATE_PASSWORD is required when APPLE_CERTIFICATE is set." >&2
      exit 1
    fi

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

    if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
      APPLE_SIGNING_IDENTITY="$(find_developer_id_identity "${TEMP_KEYCHAIN}" || true)"
      if [ -n "${APPLE_SIGNING_IDENTITY}" ]; then
        export APPLE_SIGNING_IDENTITY
      fi
    fi
  elif [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
    APPLE_SIGNING_IDENTITY="$(find_developer_id_identity || true)"
    if [ -n "${APPLE_SIGNING_IDENTITY}" ]; then
      export APPLE_SIGNING_IDENTITY
    fi
  fi

  if [ "${EVERR_ALLOW_UNSIGNED_MACOS_BUILD:-0}" != "1" ]; then
    if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
      echo "Missing a Developer ID Application signing identity. Set APPLE_SIGNING_IDENTITY or APPLE_CERTIFICATE before building." >&2
      exit 1
    fi

    if [ "${APPLE_SIGNING_IDENTITY}" = "-" ] || ! printf '%s\n' "${APPLE_SIGNING_IDENTITY}" | grep -q 'Developer ID Application:'; then
      echo "APPLE_SIGNING_IDENTITY must reference a Developer ID Application certificate for a distributable macOS build." >&2
      exit 1
    fi

    if ! have_notarization_credentials; then
      echo "Missing notarization credentials. Set APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID or APPLE_API_KEY/APPLE_API_ISSUER plus APPLE_API_KEY_PATH (or APPLE_API_PRIVATE_KEY)." >&2
      exit 1
    fi
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
