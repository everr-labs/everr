#!/usr/bin/env bash
# One trace-diff run of the self-hosted app: fresh databases, the built app
# exporting to the local collector, the workload, then a snapshot of the spans.
#
# Usage: scripts/trace-diff/run.sh <snapshot.parquet>
#
# Needs: the app built (pnpm --filter @everr/app build), Docker, the local
# collector running, `everr` with `ci trace-snapshot` (EVERR overrides the
# binary), and playwright-core in PLAYWRIGHT_DIR.
set -euo pipefail

out=${1:?usage: run.sh <snapshot.parquet>}
root=$(cd "$(dirname "$0")/../.." && pwd)
everr=${EVERR:-everr}
project=${TRACE_DIFF_PROJECT:-everr-trace-diff}
app_port=${APP_PORT:-47400}
compose=(docker compose -p "$project" -f "$root/scripts/dev/compose.yaml")
export DEV_ROOT=$root

app_pid=
cleanup() {
  if [ -n "$app_pid" ] && kill -0 "$app_pid" 2>/dev/null; then kill "$app_pid"; fi
  "${compose[@]}" down -v --timeout 10 >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Setup only runs on an empty installation, so every run starts from scratch.
"${compose[@]}" down -v --timeout 10 >/dev/null 2>&1 || true
"${compose[@]}" up -d --build postgres clickhouse-app
until "${compose[@]}" exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
until "${compose[@]}" exec -T clickhouse-app clickhouse-client --password dev \
  --query 'SELECT 1 FROM app.alert_events LIMIT 0' >/dev/null 2>&1; do sleep 1; done

port() { local address; address=$("${compose[@]}" port "$1" "$2"); echo "${address##*:}"; }

export NODE_ENV=production
export DATABASE_HOST=127.0.0.1 DATABASE_PORT=$(port postgres 5432)
export DATABASE_NAME=everr_app DATABASE_USER=everr_app DATABASE_PASSWORD=dev DATABASE_SSL=false
export CLICKHOUSE_URL=http://127.0.0.1:$(port clickhouse-app 8123)
export CLICKHOUSE_DATABASE=app CLICKHOUSE_USERNAME=app_ro CLICKHOUSE_PASSWORD=dev
export CLICKHOUSE_ADMIN_USERNAME=web_app_admin CLICKHOUSE_ADMIN_PASSWORD=dev
export CLICKHOUSE_SQL_API_USERNAME=sql_api CLICKHOUSE_SQL_API_PASSWORD=dev
# Development-only values from process-compose.yaml; this stack is thrown away.
export CLICKHOUSE_SQL_API_MASTER_KEY=everr-development-only-not-a-secret
export BETTER_AUTH_SECRET=everr-development-only-not-a-secret
export INGEST_VERIFY_SHARED_SECRET=everr-development-only-not-a-secret
export BETTER_AUTH_URL=http://localhost:$app_port PORT=$app_port
export OTEL_EXPORTER_OTLP_ENDPOINT=${OTLP_ENDPOINT:-http://127.0.0.1:54318}
export DEPLOYMENT_ENVIRONMENT=ci

pnpm --dir "$root/packages/app" db:migrate

start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
node "$root/packages/app/.output/server/index.mjs" &
app_pid=$!
until curl -sf -o /dev/null "http://127.0.0.1:$app_port/api/health"; do
  kill -0 "$app_pid" || { echo "app exited before becoming healthy" >&2; exit 1; }
  sleep 1
done

APP_URL=http://localhost:$app_port node "$root/scripts/trace-diff/workload.ts"

# SIGTERM runs the app's shutdown hooks, which flush the span exporter.
kill "$app_pid"
wait "$app_pid" || true
app_pid=

"$everr" ci trace-snapshot --from "$start" --out "$out"
