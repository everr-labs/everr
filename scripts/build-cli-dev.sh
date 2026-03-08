#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="${ROOT_DIR}/crates/everr-cli"
BUILT_BIN="${ROOT_DIR}/target/debug/everr"
OUTPUT_BIN="$HOME/.local/bin/everr"
STAGED_BIN="${ROOT_DIR}/target/desktop-resources/everr"

echo "Building everr CLI (dev/debug)..."
cargo build --manifest-path "${CLI_DIR}/Cargo.toml"

mkdir -p "$HOME/.local/bin"
mkdir -p "$(dirname "${STAGED_BIN}")"
cp "${BUILT_BIN}" "${OUTPUT_BIN}"
cp "${BUILT_BIN}" "${STAGED_BIN}"
chmod +x "${OUTPUT_BIN}"
chmod +x "${STAGED_BIN}"

echo "Installed Everr CLI to ${OUTPUT_BIN}"
echo "Staged Everr CLI resource at ${STAGED_BIN}"
echo "Run 'everr --help' to get started."
