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
export DEV_STATE_DIR="${DEV_STATE_DIR:-$DEV_ROOT/.dev}"
umask 077
mkdir -p "$DEV_STATE_DIR"
# flock is standard on Linux; macOS provides shlock, which reclaims stale PID locks.
if command -v flock >/dev/null; then
  if [ "${EVERR_DEV_LOCKED:-}" != "$DEV_STATE_DIR" ]; then
    export EVERR_DEV_LOCKED="$DEV_STATE_DIR"
    exec flock --nonblock --no-fork "$DEV_STATE_DIR/start.lock" sh scripts/dev/start.sh "$@"
  fi
elif command -v shlock >/dev/null; then
  shlock -f "$DEV_STATE_DIR/start.pid" -p $$ || {
    echo 'This checkout already has a running pnpm dev.' >&2
    exit 1
  }
else
  echo 'Install flock or shlock to prevent concurrent starts in this checkout.' >&2
  exit 1
fi
export COMPOSE_FILE="$DEV_ROOT/scripts/dev/compose.yaml"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-dev-$(printf %s "$DEV_ROOT" | shasum -a 256 | cut -c 1-12)}"
export DEV_APP_NAME="${DEV_APP_NAME:-app}"
export DEV_CLOUD_NAME="${DEV_CLOUD_NAME:-app-cloud}"
export DEV_APP_INGEST_NAME="${DEV_APP_INGEST_NAME:-app-ingest}"
export DEV_CLOUD_INGEST_NAME="${DEV_CLOUD_INGEST_NAME:-cloud-ingest}"
export DEV_APP_GITHUB_NAME="${DEV_APP_GITHUB_NAME:-app-github}"
export DEV_CLOUD_GITHUB_NAME="${DEV_CLOUD_GITHUB_NAME:-cloud-github}"
export DEV_APP_URL="$(portless get "$DEV_APP_NAME")"
export DEV_CLOUD_URL="$(portless get "$DEV_CLOUD_NAME")"
export DEV_APP_INGEST_URL="$(portless get "$DEV_APP_INGEST_NAME")"
export DEV_CLOUD_INGEST_URL="$(portless get "$DEV_CLOUD_INGEST_NAME")"
export DEV_APP_GITHUB_URL="$(portless get "$DEV_APP_GITHUB_NAME")"
export DEV_CLOUD_GITHUB_URL="$(portless get "$DEV_CLOUD_GITHUB_NAME")"
free_port() {
  node --input-type=module -e '
    import net from "node:net";
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      console.log(server.address().port);
      server.close();
    });
  '
}
export DEV_APP_GRPC_PORT="${DEV_APP_GRPC_PORT:-$(free_port)}"
export DEV_CLOUD_GRPC_PORT="${DEV_CLOUD_GRPC_PORT:-$(free_port)}"
exec process-compose --config "$DEV_ROOT/process-compose.yaml" \
  --disable-dotenv --use-uds --unix-socket "$DEV_STATE_DIR/pc.sock" --tui=false \
  --log-file "$DEV_STATE_DIR/process-compose.log" "$@"
