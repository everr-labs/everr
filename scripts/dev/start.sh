#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
export DEV_ROOT="$(pwd -P)"
export PATH="$DEV_ROOT/.dev/bin:$DEV_ROOT/node_modules/.bin:$PATH"
command -v process-compose >/dev/null || {
  echo 'Install Process Compose first: brew install process-compose' >&2
  exit 1
}
mkdir -p .dev/bin
# flock is standard on Linux; macOS provides shlock, which reclaims stale PID locks.
if command -v flock >/dev/null; then
  if [ "${EVERR_DEV_LOCKED:-}" != "$DEV_ROOT" ]; then
    export EVERR_DEV_LOCKED="$DEV_ROOT"
    exec flock --nonblock --no-fork .dev/start.lock sh scripts/dev/start.sh "$@"
  fi
elif command -v shlock >/dev/null; then
  shlock -f "$DEV_ROOT/.dev/start.pid" -p $$ || {
    echo 'This checkout already has a running pnpm dev.' >&2
    exit 1
  }
else
  echo 'Install flock or shlock to prevent concurrent starts in this checkout.' >&2
  exit 1
fi
export DEV_INSTANCE="dev-$(printf %s "$DEV_ROOT" | shasum -a 256 | cut -c 1-12)"
export DEV_STATE_DIR="$DEV_ROOT/.dev/instances/$DEV_INSTANCE"
export DEV_RUN_DIR="$DEV_STATE_DIR/run"
export COMPOSE_FILE="$DEV_ROOT/scripts/dev/compose.yaml"
export COMPOSE_PROJECT_NAME="$DEV_INSTANCE"
export DEV_APP_URL="$(portless get app)"
export DEV_CLOUD_URL="$(portless get app-cloud)"
export DEV_APP_INGEST_URL="$(portless get app-ingest)"
export DEV_CLOUD_INGEST_URL="$(portless get cloud-ingest)"
umask 077
mkdir -p "$DEV_STATE_DIR"
(cd tools/dev && go build -o ../../.dev/bin/dev-prepare ./cmd/prepare)
dev-prepare files
exec process-compose --config "$DEV_ROOT/process-compose.yaml" \
  --disable-dotenv --no-server --tui=false \
  --log-file "$DEV_RUN_DIR/process-compose.log" "$@"
