#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="${ROOT_DIR}/everr-cli"
OUTPUT_BIN="$HOME/.local/bin/everr"
DOCS_PUBLIC_DIR="${ROOT_DIR}/packages/docs/public"
CLI_ENV_MANIFEST="${DOCS_PUBLIC_DIR}/everr.cli.env"
ENV_FILE="${CLI_DIR}/.env"
EXAMPLE_ENV_FILE="${CLI_DIR}/.env.example"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
elif [[ -f "${EXAMPLE_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${EXAMPLE_ENV_FILE}"
  set +a
fi

if [[ -z "${EVERR_API_BASE_URL:-}" ]]; then
  echo "Missing EVERR_API_BASE_URL. Set it in ${ENV_FILE}, ${EXAMPLE_ENV_FILE}, or your shell env." >&2
  exit 1
fi

mkdir -p "${DOCS_PUBLIC_DIR}"
echo "dev" > "${CLI_ENV_MANIFEST}"

echo "Building everr CLI (dev/debug)..."
cargo build --manifest-path "${CLI_DIR}/Cargo.toml"

mkdir -p "$HOME/.local/bin"
cp "${CLI_DIR}/target/debug/everr" "${OUTPUT_BIN}"
chmod +x "${OUTPUT_BIN}"

echo "Installed Everr CLI to ${OUTPUT_BIN}"
echo "Wrote ${CLI_ENV_MANIFEST}"
echo "Run 'everr --help' to get started."
