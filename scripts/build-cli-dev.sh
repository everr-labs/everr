#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="${ROOT_DIR}/everr-cli"
OUTPUT_BIN="$HOME/.local/bin/everr-dev"

echo "Building everr CLI (dev/debug)..."
cargo build --manifest-path "${CLI_DIR}/Cargo.toml"

mkdir -p "$HOME/.local/bin"
cp "${CLI_DIR}/target/debug/everr" "${OUTPUT_BIN}"
chmod +x "${OUTPUT_BIN}"

echo "Installed Everr CLI to ${OUTPUT_BIN}"
echo "Run 'everr-dev --help' to get started."
