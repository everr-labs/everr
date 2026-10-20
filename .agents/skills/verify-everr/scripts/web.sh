# shellcheck shell=bash
# Web app (packages/app) commands for verify-everr. Sourced by scripts/verify-everr; not run directly.
#
#   verify-everr web-launch [RUN_ID]     compose ClickHouse+Postgres (own project/ports/volumes) + pnpm dev:web
#   verify-everr web-doctor              read-only health of this web run
#   verify-everr web-env                 print the app env of this web run
#   verify-everr web-steps <label> <steps.json>   drive the browser (ui-shot.mjs steps), session kept per run
#   verify-everr web-http <label> <METHOD> <path> [curl args...]   HTTP against the app, recorded
#   verify-everr web-webhook <label> <event> <payload.json>  signed GitHub webhook (run's own secret)
#   verify-everr web-psql <label> "<SQL>"          read-only psql in this run's Postgres, recorded
#   verify-everr web-ch <label> "<SQL>"            ClickHouse SQL (default user) in this run, recorded
#   verify-everr web-cleanup             stop dev server + compose down -v (this project only), KEEP evidence

WEB_STATE="$STATE_DIR/current-web"
JOURNEYS="$SCRIPT_DIR/journeys"

docker_cmd() {
  if docker info >/dev/null 2>&1; then echo docker
  elif sudo -n docker info >/dev/null 2>&1; then echo "sudo -n docker"
  else return 1; fi
}

web_load() {
  WEB_RUN_ID="${WEB_RUN_ID:-$(cat "$WEB_STATE" 2>/dev/null || true)}"
  [[ -n "$WEB_RUN_ID" ]] || die "no current web run; run 'verify-everr web-launch' first"
  check_run_id "$WEB_RUN_ID"
  WEB_DIR="$SCRATCH_ROOT/web-$WEB_RUN_ID"
  WEB_ART="$STATE_DIR/artifacts/web-$WEB_RUN_ID"
  [[ -f "$WEB_DIR/run.env" ]] || die "web run $WEB_RUN_ID has no $WEB_DIR/run.env (already cleaned up?)"
  # shellcheck disable=SC1091
  source "$WEB_DIR/run.env"
  DOCKER="$(docker_cmd)" || die "docker is not usable (neither 'docker' nor 'sudo -n docker' can reach the daemon)"
}

compose() {
  # shellcheck disable=SC2086
  $DOCKER compose -p "$WEB_PROJECT" --env-file "$WEB_DIR/compose.env" \
    -f "$REPO/docker-compose.yaml" -f "$SCRIPT_DIR/compose.verify.yaml" "$@"
}

ch_sql() { curl -fsS -u default:everr "$CLICKHOUSE_URL/" --data-binary "$1"; }

expected_row_policies() { cat "$REPO"/clickhouse/init/*.sql | grep -c '^CREATE ROW POLICY'; }
expected_migrations() { find "$REPO/packages/app/drizzle" -maxdepth 1 -name '*.sql' | wc -l; }
applied_migrations() {
  compose exec -T postgres psql -U postgres -tAc "select count(*) from drizzle.__drizzle_migrations" 2>/dev/null | tr -d '[:space:]'
}

cmd_web_launch() {
  if [[ -f "$WEB_STATE" ]] && [[ -f "$SCRATCH_ROOT/web-$(cat "$WEB_STATE")/run.env" ]]; then
    die "web run $(cat "$WEB_STATE") is still live; run 'verify-everr web-cleanup' first"
  fi
  DOCKER="$(docker_cmd)" || die "docker is not usable (neither 'docker' nor 'sudo -n docker' can reach the daemon)"
  command -v node >/dev/null && (( $(node -p 'process.versions.node.split(".")[0]') >= 23 )) \
    || die "need Node >= 23 on PATH (repo pins $(cat "$REPO/.nvmrc"))"
  [[ -d "$REPO/node_modules" ]] || ( cd "$REPO" && pnpm install --frozen-lockfile )
  WEB_RUN_ID="${1:-$(date +%Y%m%d-%H%M%S)-$$}"
  check_run_id "$WEB_RUN_ID"
  WEB_DIR="$SCRATCH_ROOT/web-$WEB_RUN_ID"
  WEB_ART="$STATE_DIR/artifacts/web-$WEB_RUN_ID"
  mkdir -p "$WEB_DIR" "$WEB_ART"
  local ch pg web project otlp
  ch="$(free_port)"; pg="$(free_port)"; web="$(free_port)"
  project="verify-everr-$(echo "$WEB_RUN_ID" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-\n' '-')"
  printf 'VERIFY_CH_PORT=%s\nVERIFY_PG_PORT=%s\n' "$ch" "$pg" > "$WEB_DIR/compose.env"
  # App telemetry: into this checkout's live CLI verification run if there is one, else a dead port,
  # so it never lands in someone else's collector (the app defaults to 127.0.0.1:54318).
  otlp="http://127.0.0.1:9"
  if [[ -f "$STATE_DIR/current" ]] && [[ -f "$SCRATCH_ROOT/$(cat "$STATE_DIR/current")/env" ]]; then
    otlp="$(grep EVERR_OTLP_HTTP_ORIGIN "$SCRATCH_ROOT/$(cat "$STATE_DIR/current")/env" | cut -d"'" -f2)"
  fi
  # Base: the repo's own packages/app/.env.example (non-secret dev defaults and placeholders),
  # then per-run overrides. Secrets the app needs locally are generated per run, never reused.
  {
    grep -E '^[A-Z_][A-Z0-9_]*=' "$REPO/packages/app/.env.example"
    echo "DATABASE_HOST=127.0.0.1"
    echo "DATABASE_PORT=$pg"
    echo "CLICKHOUSE_URL=http://127.0.0.1:$ch"
    echo "BETTER_AUTH_URL=http://localhost:$web"
    local s; for s in BETTER_AUTH_SECRET CLICKHOUSE_SQL_API_MASTER_KEY GITHUB_APP_STATE_SECRET \
      GITHUB_APP_WEBHOOK_SECRET POLAR_WEBHOOK_SECRET INGEST_VERIFY_SHARED_SECRET; do
      echo "$s=$(openssl rand -hex 24)"
    done
    echo "SMEE_CHANNEL="
    echo "INGRESS_COLLECTOR_URL=http://127.0.0.1:9/webhook/github"
    echo "OTEL_EXPORTER_OTLP_ENDPOINT=$otlp"
    echo "VITE_EVERR_INGEST_ENDPOINT=$otlp"
    echo "EVERR_INGEST_KEY="
  } > "$WEB_DIR/app.env"
  cat > "$WEB_DIR/run.env" <<ENV
export WEB_RUN_ID='$WEB_RUN_ID'
export WEB_PROJECT='$project'
export WEB_ORIGIN='http://localhost:$web'
export WEB_PORT='$web'
export CLICKHOUSE_URL='http://127.0.0.1:$ch'
export PG_PORT='$pg'
ENV
  echo "$WEB_RUN_ID" > "$WEB_STATE"
  # shellcheck disable=SC1091
  source "$WEB_DIR/run.env"
  grep -vE 'SECRET|MASTER_KEY|PRIVATE_KEY|PASSWORD|TOKEN' "$WEB_DIR/app.env" > "$WEB_ART/app.env.redacted"
  cp "$WEB_DIR/run.env" "$WEB_ART/run.env"
  {
    echo "web_run_id: $WEB_RUN_ID"
    echo "compose_project: $project"
    echo "git_head: $(git -C "$REPO" rev-parse HEAD)"
    echo "git_branch: $(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
    echo "docker: $DOCKER ($($DOCKER version --format '{{.Server.Version}}'))"
    echo "launched_at: $(date '+%F %T %Z')"
  } > "$WEB_ART/run.txt"
  echo "launching web run $WEB_RUN_ID (project $project, ch :$ch, pg :$pg, web :$web)"

  local t0=$SECONDS
  compose build clickhouse >"$WEB_ART/compose-build.log" 2>&1 || { tail -20 "$WEB_ART/compose-build.log"; die "clickhouse image build failed"; }
  compose up -d --wait clickhouse postgres >"$WEB_ART/compose-up.log" 2>&1 || { tail -20 "$WEB_ART/compose-up.log"; die "compose up failed; run 'verify-everr web-cleanup'"; }
  # Healthy is not ready: wait until the last ClickHouse init script created every row policy.
  local want_rp; want_rp="$(expected_row_policies)"
  local deadline=$((SECONDS + 120))
  until [[ "$(ch_sql 'SELECT count() FROM system.row_policies' 2>/dev/null | tr -d '[:space:]')" == "$want_rp" ]]; do
    (( SECONDS < deadline )) || die "ClickHouse init never created $want_rp row policies; see 'compose logs clickhouse'"
    sleep 1
  done
  echo "stack ready in $((SECONDS - t0))s (ClickHouse $want_rp row policies, Postgres healthy)"

  # Start the repo's own dev command, in its own process group, bound to loopback.
  ( set -a; source "$WEB_DIR/app.env"; set +a; cd "$REPO"
    exec setsid pnpm dev:web --port "$web" --strictPort --host 127.0.0.1 ) >"$WEB_DIR/web.log" 2>&1 &
  echo $! > "$WEB_DIR/web.pgid"
  # Ready = health answers, every drizzle migration applied (the server runs them on first load),
  # and both Graphile Worker runners connected.
  local want_mig; want_mig="$(expected_migrations)"
  deadline=$((SECONDS + 240))
  until curl -fsS -m 60 "$WEB_ORIGIN/api/health" 2>/dev/null | grep -q '"ok":true' \
        && [[ "$(applied_migrations)" == "$want_mig" ]] \
        && (( $(grep -c 'Worker connected and looking for jobs' "$WEB_DIR/web.log") >= 2 )); do
    kill -0 "$(cat "$WEB_DIR/web.pgid")" 2>/dev/null || { tail -30 "$WEB_DIR/web.log"; die "dev server exited; run 'verify-everr web-cleanup'"; }
    (( SECONDS < deadline )) || { tail -30 "$WEB_DIR/web.log"; die "web app not ready in 240s; run 'verify-everr web-cleanup'"; }
    sleep 2
  done
  echo "web_port_pids=$(port_pids "$web")" > "$WEB_DIR/pids"
  cp "$WEB_DIR/pids" "$WEB_ART/pids.txt"
  echo "launch_seconds: $((SECONDS - t0))" >> "$WEB_ART/run.txt"
  echo "WEB READY run=$WEB_RUN_ID url=$WEB_ORIGIN migrations=$want_mig/$want_mig ($((SECONDS - t0))s)"
}

cmd_web_doctor() {
  web_load
  local ok=1
  wcheck() { if eval "$2" >/dev/null 2>&1; then echo "ok   $1"; else echo "FAIL $1"; ok=0; fi; }
  echo "web run: $WEB_RUN_ID  project: $WEB_PROJECT  head: $(git -C "$REPO" rev-parse --short HEAD)"
  local svc; for svc in clickhouse postgres; do
    wcheck "$svc container of project $WEB_PROJECT is healthy" \
      "compose ps --format '{{.Service}} {{.Health}}' | grep -qx '$svc healthy'"
  done
  wcheck "ClickHouse on :${CLICKHOUSE_URL##*:} answers as app_ro (app-dev)" \
    "curl -fsS -u app_ro:app-dev '$CLICKHOUSE_URL/?query=SELECT%201'"
  wcheck "ClickHouse row policies = $(expected_row_policies)" \
    "[[ \"\$(ch_sql 'SELECT count() FROM system.row_policies' | tr -d '[:space:]')\" == '$(expected_row_policies)' ]]"
  wcheck "Postgres drizzle migrations applied = $(expected_migrations)" "[[ \"\$(applied_migrations)\" == '$(expected_migrations)' ]]"
  wcheck "dev server process group $(cat "$WEB_DIR/web.pgid") alive" "kill -0 $(cat "$WEB_DIR/web.pgid")"
  local want now; want="$(cut -d= -f2 "$WEB_DIR/pids")"; now="$(port_pids "$WEB_PORT")"
  wcheck "web port $WEB_PORT owned by launch pids [$want]" "[[ -n '$want' && '$want' == '$now' ]]"
  wcheck "GET /api/health is {\"ok\":true}" "curl -fsS '$WEB_ORIGIN/api/health' | grep -q '\"ok\":true'"
  wcheck "GET /auth/sign-in serves the app shell" "curl -fsS '$WEB_ORIGIN/auth/sign-in' | grep -q '<html'"
  if $DOCKER ps --format '{{.Names}}' | grep -qv "^$WEB_PROJECT-"; then
    echo "info other containers exist on this host (not ours, never touched): $($DOCKER ps --format '{{.Names}}' | grep -v "^$WEB_PROJECT-" | tr '\n' ' ')"
  fi
  (( ok )) && echo "WEB DOCTOR OK" || { echo "WEB DOCTOR FAILED"; return 1; }
}

cmd_web_env() { web_load; cat "$WEB_DIR/run.env"; grep -vE 'SECRET|MASTER_KEY|PRIVATE_KEY|PASSWORD|TOKEN' "$WEB_DIR/app.env"; }

cmd_web_steps() {
  web_load
  local label="${1:?label required}" steps="${2:?steps.json required}"
  [[ -f "$steps" ]] || steps="$JOURNEYS/$steps"
  [[ -f "$steps" ]] || die "no steps file $2 (looked in . and $JOURNEYS)"
  local chrome; chrome="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)}"
  [[ -n "$chrome" ]] || die "no Chrome/Chromium on PATH (set CHROME=/path/to/chrome)"
  local out="$WEB_ART/web/$label"
  # Never overwrite an earlier attempt's evidence: keep it next to the new one.
  [[ -e "$out" ]] && mv "$out" "$out.prev-$(date +%H%M%S)"
  mkdir -p "$out"
  set +e
  CHROME="$chrome" PROFILE_DIR="$WEB_DIR/chrome-profile" SCRATCH_DIR="$WEB_DIR" \
    node "$SCRIPT_DIR/ui-shot.mjs" steps "$WEB_ORIGIN" "$out" "$steps"
  local rc=$?
  set -e
  echo "web evidence: $out ($(ls "$out" | tr '\n' ' '))"
  return $rc
}

cmd_web_http() {
  web_load
  local label="${1:?label required}" method="${2:?method required}" path="${3:?path required}"; shift 3
  local out="$WEB_ART/http/$label"
  [[ -e "$out" ]] && mv "$out" "$out.prev-$(date +%H%M%S)"
  mkdir -p "$out"
  printf '%q ' curl -sS -X "$method" "$@" "$WEB_ORIGIN$path" > "$out/command.txt"; echo >> "$out/command.txt"
  curl -sS -X "$method" -o "$out/body" -D "$out/headers" -w '%{http_code}' "$@" "$WEB_ORIGIN$path" > "$out/status" || true
  echo "$method $path -> $(cat "$out/status")"; head -c 400 "$out/body"; echo
}

# verify-everr web-webhook <label> <event> <payload.json>
# POST a GitHub webhook to /webhook/github signed with THIS run's GITHUB_APP_WEBHOOK_SECRET
# (generated at web-launch), exactly as GitHub signs deliveries for a configured App.
cmd_web_webhook() {
  web_load
  local label="${1:?label required}" event="${2:?event required}" payload="${3:?payload file required}"
  [[ -f "$payload" ]] || payload="$JOURNEYS/$payload"
  local secret sig delivery
  secret="$(grep '^GITHUB_APP_WEBHOOK_SECRET=' "$WEB_DIR/app.env" | tail -1 | cut -d= -f2-)"
  sig="sha256=$(openssl dgst -sha256 -hmac "$secret" -r < "$payload" | cut -d' ' -f1)"
  delivery="verify-$(date +%s)-$$"
  echo "$delivery" > "$WEB_DIR/last-delivery"
  cmd_web_http "$label" POST /webhook/github -H 'content-type: application/json' \
    -H "x-github-event: $event" -H "x-github-delivery: $delivery" -H "x-hub-signature-256: $sig" \
    --data-binary "@$payload"
  echo "delivery: $delivery" | tee "$WEB_ART/http/$label/delivery.txt"
}

cmd_web_psql() {
  web_load
  local label="${1:?label required}" sql="${2:?sql required}"
  local out="$WEB_ART/db/$label"; mkdir -p "$out"
  echo "$sql" > "$out/query.sql"
  compose exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -c 'SET default_transaction_read_only = on' -c "$sql" \
    > "$out/stdout" 2> "$out/stderr"; local rc=$?
  echo "$rc" > "$out/exit_code"; cat "$out/stdout" "$out/stderr"; return $rc
}

cmd_web_ch() {
  web_load
  local label="${1:?label required}" sql="${2:?sql required}"
  local out="$WEB_ART/db/$label"; mkdir -p "$out"
  echo "$sql" > "$out/query.sql"
  ch_sql "$sql FORMAT JSONEachRow" > "$out/stdout" 2> "$out/stderr"; local rc=$?
  echo "$rc" > "$out/exit_code"; cat "$out/stdout" "$out/stderr"; return $rc
}

cmd_web_cleanup() {
  WEB_RUN_ID="${WEB_RUN_ID:-$(cat "$WEB_STATE" 2>/dev/null || true)}"
  [[ -n "$WEB_RUN_ID" ]] || { echo "no web run to clean up"; return 0; }
  check_run_id "$WEB_RUN_ID"
  WEB_DIR="$SCRATCH_ROOT/web-$WEB_RUN_ID"; WEB_ART="$STATE_DIR/artifacts/web-$WEB_RUN_ID"
  mkdir -p "$WEB_ART"
  if [[ -f "$WEB_DIR/run.env" ]]; then
    # shellcheck disable=SC1091
    source "$WEB_DIR/run.env"
    DOCKER="$(docker_cmd || echo docker)"
    # Dev server: signal the process group we started (setsid leader), never by name.
    if [[ -f "$WEB_DIR/web.pgid" ]]; then
      local pgid; pgid="$(cat "$WEB_DIR/web.pgid")"
      kill -TERM -- "-$pgid" 2>/dev/null || true
      local deadline=$((SECONDS + 15))
      while [[ -n "$(port_pids "$WEB_PORT")" ]] && (( SECONDS < deadline )); do sleep 0.5; done
      kill -KILL -- "-$pgid" 2>/dev/null || true
      [[ -z "$(port_pids "$WEB_PORT")" ]] || echo "WARN web port $WEB_PORT still listening" | tee -a "$WEB_ART/cleanup.txt"
    fi
    [[ -f "$WEB_DIR/web.log" ]] && cp "$WEB_DIR/web.log" "$WEB_ART/web.log"
    compose logs --no-color > "$WEB_ART/compose.log" 2>&1 || true
    # Only this run's compose project, with its named volumes. Other projects are untouched.
    compose down -v --remove-orphans >> "$WEB_ART/cleanup.txt" 2>&1 || echo "WARN compose down failed" | tee -a "$WEB_ART/cleanup.txt"
    $DOCKER ps -a --filter "label=com.docker.compose.project=$WEB_PROJECT" --format '{{.Names}}' | sed 's/^/WARN leftover container: /' | tee -a "$WEB_ART/cleanup.txt"
  fi
  rm -rf "$WEB_DIR"
  if [[ "$(cat "$WEB_STATE" 2>/dev/null || true)" == "$WEB_RUN_ID" ]]; then rm -f "$WEB_STATE"; fi
  echo "cleaned up web run $WEB_RUN_ID; evidence kept at $WEB_ART"
  ls "$WEB_ART"
}
