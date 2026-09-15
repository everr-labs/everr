#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
# Point this at another worktree with installed dependencies if needed.
deps_root="${BENCH_DEPS_ROOT:-$repo_root}"
bundle_dir="$(mktemp -d "${TMPDIR:-/tmp}/trace-search-bundle.XXXXXX")"
trap 'rm -rf "$bundle_dir"' EXIT

base_ref="${BENCH_BASE_REF:-795604e7a06d9623f441fe7ab2dcc23cc2857e8e}"
(
  cd "$repo_root/packages/telemetry-explorer/src/traces/data"
  git show "$base_ref:packages/telemetry-explorer/src/traces/data/repository.ts" | \
    NODE_PATH="$deps_root/node_modules:$deps_root/packages/app/node_modules" \
    "$deps_root/node_modules/.bin/esbuild" --bundle --platform=node --format=esm \
    --loader=ts \
    "--alias:@everr/ui=$repo_root/packages/ui/src" \
    "--alias:@everr/datemath=$repo_root/packages/datemath/src/index.ts" \
    "--outfile=$bundle_dir/baseline.mjs"
)

NODE_PATH="$deps_root/node_modules:$deps_root/packages/app/node_modules" \
  "$deps_root/node_modules/.bin/esbuild" "$repo_root/scripts/benchmarks/trace-search.ts" \
  --bundle --platform=node --format=esm \
  "--alias:@everr/ui=$repo_root/packages/ui/src" \
  "--alias:@everr/datemath=$repo_root/packages/datemath/src/index.ts" \
  "--outfile=$bundle_dir/benchmark.mjs"

CHDB_MODULE="$deps_root/packages/app/node_modules/chdb" \
  BENCH_BASELINE_MODULE="$bundle_dir/baseline.mjs" \
  node "$bundle_dir/benchmark.mjs" "$@"
