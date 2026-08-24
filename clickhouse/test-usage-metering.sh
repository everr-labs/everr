#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container_name="everr-clickhouse-usage-test-$$"
admin_password="everr"
# The run id is stored inside the fixture rows' ResourceAttributes, so its
# length is part of the golden byteSize value below. Keep it constant: a
# PID-derived id made the golden assertion fail whenever the PID had a
# different digit count. Uniqueness buys nothing in a fresh per-run container.
validation_run_id="usage-metering-test-fixture"

cleanup() {
  docker rm --force "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "usage metering integration test failed: $*" >&2
  exit 1
}

ch_as() {
  local user="$1"
  local password="$2"
  local query="$3"
  local command=(
    docker exec "$container_name" clickhouse-client
    --user "$user"
    --password "$password"
  )
  if [[ "$user" == "collector_rw" ]]; then
    command+=(
      --async_insert=1
      --wait_for_async_insert=1
      --deduplicate_blocks_in_dependent_materialized_views=1
      --materialized_views_ignore_errors=0
      --asterisk_include_materialized_columns=0
    )
  fi
  command+=(--format TSVRaw --query "$query")
  "${command[@]}"
}

ch() {
  ch_as default "$admin_password" "$1"
}

assert_eq() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" != "$expected" ]]; then
    fail "$label: expected '$expected', got '$actual'"
  fi
}

command -v docker >/dev/null 2>&1 || fail "docker is required"

# The apply body must remain identical to the fresh-init body. Header comments
# differ because the files serve different operators.
if ! diff -u \
  <(sed -n '/^ALTER TABLE otel\.otel_traces/,$p' "$repo_root/clickhouse/init/13-create-usage-metering.sql") \
  <(sed -n '/^ALTER TABLE otel\.otel_traces/,$p' "$repo_root/clickhouse/apply-usage-metering.sql"); then
  fail "fresh-init and existing-cluster SQL bodies differ"
fi

# Start the pinned base image without the repository's init directory, then run
# every pre-feature init file explicitly. This proves that the cloud apply path
# installs the feature instead of merely reapplying an already initialized 13.
docker run --detach \
  --name "$container_name" \
  --env CLICKHOUSE_USER=default \
  --env CLICKHOUSE_PASSWORD="$admin_password" \
  --env CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 \
  --env COLLECTOR_RW_PASSWORD=collector-dev \
  --env APP_RO_PASSWORD=app-dev \
  --env WEB_APP_ADMIN_PASSWORD=web-app-admin-dev \
  clickhouse/clickhouse-server:26.2 >/dev/null

ready=0
for _attempt in $(seq 1 90); do
  if docker exec "$container_name" clickhouse-client \
      --user default \
      --password "$admin_password" \
      --format TSVRaw \
      --query "SELECT 1" 2>/dev/null | grep -qx '1'; then
    ready=1
    break
  fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "$container_name" 2>/dev/null || true)" != "true" ]]; then
    docker logs "$container_name" >&2 || true
    fail "ClickHouse exited during initialization"
  fi
  sleep 1
done

if [[ "$ready" != "1" ]]; then
  docker logs "$container_name" >&2 || true
  fail "ClickHouse did not become ready"
fi

docker exec --interactive "$container_name" bash -s \
  < "$repo_root/clickhouse/init/00-setup.sh"
for init_file in \
  03-create-otel-tables.sql \
  04-create-error-fingerprint-function.sql \
  10-create-mvs.sql \
  12-create-alert-events.sql \
  15-create-sql-api-role.sql \
  20-apply-rls.sql; do
  docker exec --interactive "$container_name" clickhouse-client \
    --user default \
    --password "$admin_password" \
    --multiquery < "$repo_root/clickhouse/init/$init_file"
done

assert_eq \
  "pre-feature usage table absence" \
  "0" \
  "$(ch "SELECT count() FROM system.tables WHERE database = 'app' AND name = 'tenant_usage'")"

# Seed a deliberately stale materialized definition and a historical row. The
# apply must correct future inserts without rewriting or billing this old part.
ch "ALTER TABLE otel.otel_logs ADD COLUMN RowBytes UInt64 MATERIALIZED toUInt64(1)"
ch_as collector_rw collector-dev "
  INSERT INTO otel.otel_logs
    (Timestamp, TimestampTime, ServiceName, Body, ResourceAttributes)
  VALUES
    (now64(9, 'UTC'), now('UTC'), 'usage-test', 'before usage apply',
     map('everr.tenant.id', 'tenant-stale'))
"
assert_eq \
  "stale RowBytes fixture" \
  "1" \
  "$(ch "SELECT RowBytes FROM otel.otel_logs WHERE Body = 'before usage apply'")"

docker cp "$repo_root/clickhouse/usage-metering-rollout.sh" \
  "$container_name:/tmp/usage-metering-rollout.sh"
docker cp "$repo_root/clickhouse/apply-usage-metering.sql" \
  "$container_name:/tmp/apply-usage-metering.sql"
docker exec "$container_name" chmod +x /tmp/usage-metering-rollout.sh

# Preflight runs as the actual collector identity, while apply and schema
# validation run as the administrator.
docker exec "$container_name" /tmp/usage-metering-rollout.sh preflight \
  --user collector_rw --password collector-dev \
  --async_insert=1 \
  --wait_for_async_insert=1 \
  --deduplicate_blocks_in_dependent_materialized_views=1 \
  --materialized_views_ignore_errors=0 \
  --asterisk_include_materialized_columns=0 >/dev/null
docker exec "$container_name" /tmp/usage-metering-rollout.sh apply \
  --user default --password "$admin_password" >/dev/null
docker exec "$container_name" /tmp/usage-metering-rollout.sh validate-schema \
  --user default --password "$admin_password" >/dev/null

server_version="$(ch "SELECT version()")"
[[ "$server_version" == 26.2.* ]] || fail "expected ClickHouse 26.2, got $server_version"
assert_eq \
  "MATERIALIZED columns excluded from wildcard reads" \
  "0" \
  "$(ch "SELECT value FROM system.settings WHERE name = 'asterisk_include_materialized_columns'")"
assert_eq \
  "usage bucket type" \
  "DateTime('UTC')" \
  "$(ch "SELECT type FROM system.columns WHERE database = 'app' AND table = 'tenant_usage' AND name = 'bucket'")"
assert_eq \
  "usage sorting key" \
  "tenant_id, bucket, meter" \
  "$(ch "SELECT sorting_key FROM system.tables WHERE database = 'app' AND name = 'tenant_usage'")"
assert_eq \
  "metering materialized view count" \
  "7" \
  "$(ch "SELECT count() FROM system.tables WHERE database = 'app' AND name LIKE 'tenant_usage%_mv'")"
assert_eq \
  "stale expression converged" \
  "1" \
  "$(ch "SELECT startsWith(default_expression, 'byteSize(') FROM system.columns WHERE database = 'otel' AND table = 'otel_logs' AND name = 'RowBytes'")"
assert_eq \
  "historical materialized value is not rewritten" \
  "1" \
  "$(ch "SELECT RowBytes FROM otel.otel_logs WHERE Body = 'before usage apply'")"
assert_eq \
  "historical row is not backfilled" \
  "0" \
  "$(ch "SELECT sum(items) FROM app.tenant_usage WHERE tenant_id = 'tenant-stale'")"

validation_bucket="$(ch "SELECT toString(toStartOfHour(now('UTC')), 'UTC')")"

ch_as collector_rw collector-dev "
  INSERT INTO otel.otel_traces
    (Timestamp, TraceId, SpanId, SpanName, ServiceName, ResourceAttributes, Duration)
  VALUES
    (now64(9, 'UTC'), 'trace-a', 'span-a', 'request', 'usage-test',
     map('everr.tenant.id', 'tenant-a',
         'everr.usage.validation.run_id', '$validation_run_id'), 1250000)
"

ch_as collector_rw collector-dev "
  INSERT INTO otel.otel_logs
    (Timestamp, TimestampTime, TraceId, SpanId, SeverityText, SeverityNumber,
     ServiceName, Body, ResourceAttributes, LogAttributes, EventName)
  VALUES
    (now64(9, 'UTC'), now('UTC'), 'trace-a', 'span-a', 'INFO', 9,
     'usage-test', 'metered log',
     map('everr.tenant.id', 'tenant-a',
         'everr.usage.validation.run_id', '$validation_run_id'),
     map('test.attribute', 'log-value'), 'usage.test')
"

ch_as collector_rw collector-dev "
  INSERT INTO otel.otel_metrics_gauge
    (ResourceAttributes, ServiceName, MetricName, MetricDescription,
     MetricUnit, Attributes, StartTimeUnix, TimeUnix, Value)
  VALUES
    (map('everr.tenant.id', 'tenant-a',
         'everr.usage.validation.run_id', '$validation_run_id'),
     'usage-test', 'test.gauge',
     'gauge description', 'ms', map('route', '/gauge'),
     now64(9, 'UTC'), now64(9, 'UTC'), 12.5)
"

ch_as collector_rw collector-dev "
  INSERT INTO otel.otel_metrics_sum
    (ResourceAttributes, ServiceName, MetricName, MetricDescription,
     MetricUnit, Attributes, StartTimeUnix, TimeUnix, Value,
     AggregationTemporality, IsMonotonic)
  VALUES
    (map('everr.tenant.id', 'tenant-a',
         'everr.usage.validation.run_id', '$validation_run_id'),
     'usage-test', 'test.sum',
     'sum description', 'requests', map('route', '/sum'),
     now64(9, 'UTC'), now64(9, 'UTC'), 7, 2, true)
"

ch_as collector_rw collector-dev "
  INSERT INTO otel.otel_metrics_histogram
    (ResourceAttributes, ServiceName, MetricName, MetricDescription,
     MetricUnit, Attributes, StartTimeUnix, TimeUnix, Count, Sum,
     BucketCounts, ExplicitBounds, Flags, Min, Max, AggregationTemporality)
  VALUES
    (map('everr.tenant.id', 'tenant-a',
         'everr.usage.validation.run_id', '$validation_run_id'),
     'usage-test', 'test.histogram',
     'histogram description', 'ms', map('route', '/histogram'),
     now64(9, 'UTC'), now64(9, 'UTC'), 2, 15,
     [1, 1], [5], 0, 5, 10, 2)
"

ch_as collector_rw collector-dev "
  INSERT INTO otel.otel_metrics_exponential_histogram
    (ResourceAttributes, ServiceName, MetricName, MetricDescription,
     MetricUnit, Attributes, StartTimeUnix, TimeUnix, Count, Sum, Scale,
     ZeroCount, PositiveOffset, PositiveBucketCounts, NegativeOffset,
     NegativeBucketCounts, Flags, Min, Max, AggregationTemporality)
  VALUES
    (map('everr.tenant.id', 'tenant-a',
         'everr.usage.validation.run_id', '$validation_run_id'),
     'usage-test',
     'test.exponential_histogram', 'exponential histogram description', 'ms',
     map('route', '/exponential-histogram'), now64(9, 'UTC'),
     now64(9, 'UTC'), 3, 18, 2, 1, 0, [1, 1], 0, [0], 0, 2, 9, 2)
"

ch_as collector_rw collector-dev "
  INSERT INTO otel.otel_metrics_summary
    (ResourceAttributes, ServiceName, MetricName, MetricDescription,
     MetricUnit, Attributes, StartTimeUnix, TimeUnix, Count, Sum,
     \`ValueAtQuantiles.Quantile\`, \`ValueAtQuantiles.Value\`, Flags)
  VALUES
    (map('everr.tenant.id', 'tenant-a',
         'everr.usage.validation.run_id', '$validation_run_id'),
     'usage-test', 'test.summary',
     'summary description', 'ms', map('route', '/summary'),
     now64(9, 'UTC'), now64(9, 'UTC'), 2, 12, [0.5, 0.9], [5, 7], 0)
"

tables=(
  otel_traces
  otel_logs
  otel_metrics_gauge
  otel_metrics_sum
  otel_metrics_histogram
  otel_metrics_exponential_histogram
  otel_metrics_summary
)
for table in "${tables[@]}"; do
  assert_eq \
    "$table RowBytes contract" \
    "0" \
    "$(ch "SELECT countIf(RowBytes != byteSize(*)) FROM otel.$table WHERE ResourceAttributes['everr.usage.validation.run_id'] = '$validation_run_id' SETTINGS asterisk_include_materialized_columns = 0")"
done

# Pin ClickHouse's byteSize accounting for a complete fixture. The timestamp
# values vary between runs, but DateTime64(9) and DateTime have fixed widths,
# and the run id above is constant, so the result is deterministic.
assert_eq \
  "log byteSize golden contract" \
  "316" \
  "$(ch "SELECT byteSize(*) FROM otel.otel_logs WHERE Body = 'metered log' SETTINGS asterisk_include_materialized_columns = 0")"

assert_eq \
  "trace bytes" \
  "$(ch "SELECT sum(RowBytes) FROM otel.otel_traces WHERE ResourceAttributes['everr.tenant.id'] = 'tenant-a'")" \
  "$(ch "SELECT sum(bytes) FROM app.tenant_usage WHERE tenant_id = 'tenant-a' AND meter = 'traces'")"
assert_eq \
  "trace items" \
  "1" \
  "$(ch "SELECT sum(items) FROM app.tenant_usage WHERE tenant_id = 'tenant-a' AND meter = 'traces'")"

assert_eq \
  "log bytes" \
  "$(ch "SELECT sum(RowBytes) FROM otel.otel_logs WHERE ResourceAttributes['everr.tenant.id'] = 'tenant-a'")" \
  "$(ch "SELECT sum(bytes) FROM app.tenant_usage WHERE tenant_id = 'tenant-a' AND meter = 'logs'")"
assert_eq \
  "log items" \
  "1" \
  "$(ch "SELECT sum(items) FROM app.tenant_usage WHERE tenant_id = 'tenant-a' AND meter = 'logs'")"

raw_metric_bytes="$(ch "
  SELECT sum(metric_bytes)
  FROM
  (
    SELECT sum(RowBytes) AS metric_bytes FROM otel.otel_metrics_gauge
    UNION ALL
    SELECT sum(RowBytes) AS metric_bytes FROM otel.otel_metrics_sum
    UNION ALL
    SELECT sum(RowBytes) AS metric_bytes FROM otel.otel_metrics_histogram
    UNION ALL
    SELECT sum(RowBytes) AS metric_bytes FROM otel.otel_metrics_exponential_histogram
    UNION ALL
    SELECT sum(RowBytes) AS metric_bytes FROM otel.otel_metrics_summary
  )
")"
assert_eq \
  "metric bytes" \
  "$raw_metric_bytes" \
  "$(ch "SELECT sum(bytes) FROM app.tenant_usage WHERE tenant_id = 'tenant-a' AND meter = 'metrics'")"
assert_eq \
  "metric items" \
  "5" \
  "$(ch "SELECT sum(items) FROM app.tenant_usage WHERE tenant_id = 'tenant-a' AND meter = 'metrics'")"

docker exec \
  --env USAGE_METERING_VALIDATION_TENANT_ID=tenant-a \
  --env USAGE_METERING_VALIDATION_TENANT_IS_DEDICATED=yes \
  --env USAGE_METERING_VALIDATION_RUN_ID="$validation_run_id" \
  --env USAGE_METERING_VALIDATION_BUCKET="$validation_bucket" \
  "$container_name" /tmp/usage-metering-rollout.sh validate-data \
  --user default --password "$admin_password" >/dev/null

assert_eq "trace fan-out" "1" "$(ch "SELECT count() FROM app.traces WHERE tenant_id = 'tenant-a'")"
assert_eq "log fan-out" "1" "$(ch "SELECT count() FROM app.logs WHERE tenant_id = 'tenant-a'")"
assert_eq "gauge fan-out" "1" "$(ch "SELECT count() FROM app.metrics_gauge WHERE tenant_id = 'tenant-a'")"
assert_eq "sum fan-out" "1" "$(ch "SELECT count() FROM app.metrics_sum WHERE tenant_id = 'tenant-a'")"
assert_eq "histogram fan-out" "1" "$(ch "SELECT count() FROM app.metrics_histogram WHERE tenant_id = 'tenant-a'")"
assert_eq \
  "exponential histogram fan-out" \
  "1" \
  "$(ch "SELECT count() FROM app.metrics_exponential_histogram WHERE tenant_id = 'tenant-a'")"
assert_eq "summary fan-out" "1" "$(ch "SELECT count() FROM app.metrics_summary WHERE tenant_id = 'tenant-a'")"

assert_eq \
  "arrival buckets are UTC hour starts" \
  "0" \
  "$(ch "SELECT countIf(bucket != toStartOfHour(bucket)) FROM app.tenant_usage")"

assert_eq \
  "tenant-a RLS" \
  "7" \
  "$(ch_as app_ro app-dev "SELECT sum(items) FROM app.tenant_usage SETTINGS SQL_everr_tenant_id = 'tenant-a'")"
assert_eq \
  "other-tenant RLS" \
  "0" \
  "$(ch_as app_ro app-dev "SELECT sum(items) FROM app.tenant_usage SETTINGS SQL_everr_tenant_id = 'tenant-b'")"

ch_as collector_rw collector-dev "
  INSERT INTO otel.otel_logs
    (Timestamp, TimestampTime, ServiceName, Body, ResourceAttributes)
  VALUES
    (now64(9, 'UTC'), now('UTC'), 'usage-test', 'unattributed log', map())
"

assert_eq \
  "unattributed admin visibility" \
  "1" \
  "$(ch_as web_app_admin web-app-admin-dev "SELECT sum(items) FROM app.tenant_usage WHERE tenant_id = ''")"
assert_eq \
  "unattributed hidden by tenant-a RLS" \
  "7" \
  "$(ch_as app_ro app-dev "SELECT sum(items) FROM app.tenant_usage SETTINGS SQL_everr_tenant_id = 'tenant-a'")"

ch_as collector_rw collector-dev "
  INSERT INTO otel.otel_logs
    (Timestamp, TimestampTime, ServiceName, Body, ResourceAttributes)
  VALUES
    (now64(9, 'UTC'), now('UTC'), 'usage-test', 'other tenant log',
     map('everr.tenant.id', 'tenant-b'))
"
assert_eq \
  "tenant-b RLS before reapply" \
  "1" \
  "$(ch_as app_ro app-dev "SELECT sum(items) FROM app.tenant_usage SETTINGS SQL_everr_tenant_id = 'tenant-b'")"
assert_eq \
  "cross-tenant admin visibility" \
  "9" \
  "$(ch_as web_app_admin web-app-admin-dev "SELECT sum(items) FROM app.tenant_usage")"

# Repeat the full rollout while multiple tenant rows already exist. The policy
# is replaced in one DDL statement, expressions converge again, and neither
# views nor counters are duplicated.
docker exec "$container_name" /tmp/usage-metering-rollout.sh apply \
  --user default --password "$admin_password" >/dev/null
docker exec "$container_name" /tmp/usage-metering-rollout.sh validate-schema \
  --user default --password "$admin_password" >/dev/null
assert_eq \
  "tenant-a RLS after populated reapply" \
  "7" \
  "$(ch_as app_ro app-dev "SELECT sum(items) FROM app.tenant_usage SETTINGS SQL_everr_tenant_id = 'tenant-a'")"
assert_eq \
  "tenant-b RLS after populated reapply" \
  "1" \
  "$(ch_as app_ro app-dev "SELECT sum(items) FROM app.tenant_usage SETTINGS SQL_everr_tenant_id = 'tenant-b'")"
assert_eq \
  "unattributed remains hidden after populated reapply" \
  "7" \
  "$(ch_as app_ro app-dev "SELECT sum(items) FROM app.tenant_usage SETTINGS SQL_everr_tenant_id = 'tenant-a'")"
assert_eq \
  "populated reapply does not duplicate usage" \
  "9" \
  "$(ch_as web_app_admin web-app-admin-dev "SELECT sum(items) FROM app.tenant_usage")"
assert_eq \
  "populated reapply does not backfill historical row" \
  "0" \
  "$(ch "SELECT sum(items) FROM app.tenant_usage WHERE tenant_id = 'tenant-stale'")"

echo "usage metering integration test passed on ClickHouse $server_version"
