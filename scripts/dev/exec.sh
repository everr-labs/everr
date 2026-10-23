#!/bin/sh
set -eu

if [ "$#" -lt 3 ]; then
  echo 'Usage: exec.sh <app|collector> <app|cloud> <command> [args...]' >&2
  exit 1
fi
kind="$1"
variant="$2"
shift 2
case "$kind:$variant" in
  app:app|app:cloud|collector:app|collector:cloud) ;;
  *) echo "Unknown development process: $kind $variant" >&2; exit 1 ;;
esac

port() {
  address=$(docker compose port "$1" "$2") || return
  printf '%s\n' "${address##*:}"
}

clickhouse_port=$(port "clickhouse-$variant" 8123)
export CLICKHOUSE_URL="http://127.0.0.1:$clickhouse_port"

if [ "$kind" = app ]; then
  postgres_port=$(port postgres 5432)
  export DATABASE_PORT="$postgres_port"
  export BETTER_AUTH_URL="$PORTLESS_URL"
  if [ "${DEV_MAIL:-false}" = true ]; then
    smtp_port=$(port mailpit 1025)
    export EMAIL_DSN="smtp://127.0.0.1:$smtp_port"
  fi
else
  if [ -n "${EVERR_QUEUE_DIRECTORY:-}" ]; then
    mkdir -p "$EVERR_QUEUE_DIRECTORY"
  fi
  if [ -n "${NODE_EXTRA_CA_CERTS:-}" ]; then
    export SSL_CERT_FILE="$NODE_EXTRA_CA_CERTS"
  fi
fi

exec "$@"
