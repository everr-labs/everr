#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="${ROOT_DIR}/everr-cli"
PUBLIC_DIR="${ROOT_DIR}/packages/docs/public"
OUTPUT_BIN="${PUBLIC_DIR}/everr"
OUTPUT_SHA="${PUBLIC_DIR}/everr.sha256"
CLI_ENV_MANIFEST="${PUBLIC_DIR}/everr.cli.env"
ENV_FILE="${CLI_DIR}/.env.prod"
EXAMPLE_ENV_FILE="${CLI_DIR}/.env.prod.example"

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

mkdir -p "${PUBLIC_DIR}"
echo "prod" > "${CLI_ENV_MANIFEST}"

echo "Building everr CLI (release)..."
cargo build --release --manifest-path "${CLI_DIR}/Cargo.toml"

cp "${CLI_DIR}/target/release/everr" "${OUTPUT_BIN}"
chmod +x "${OUTPUT_BIN}"

if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "${OUTPUT_BIN}" | awk '{print $1 "  everr"}' > "${OUTPUT_SHA}"
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${OUTPUT_BIN}" | awk '{print $1 "  everr"}' > "${OUTPUT_SHA}"
else
  echo "Missing checksum tool: install shasum or sha256sum." >&2
  exit 1
fi

echo "Wrote ${OUTPUT_BIN}"
echo "Wrote ${OUTPUT_SHA}"
echo "Wrote ${CLI_ENV_MANIFEST}"

cp "${OUTPUT_BIN}" "$HOME/.local/bin/everr"
chmod +x "$HOME/.local/bin/everr"

echo "Installed Everr CLI to $HOME/.local/bin/everr"
echo "Run 'everr --help' to get started."
