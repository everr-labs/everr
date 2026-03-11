-- Traces: tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.traces
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (tenant_id, ServiceName, SpanName, toDateTime(Timestamp))
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
FROM otel.otel_traces
WHERE 1 = 0;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.traces_mv
TO app.traces
AS
SELECT
  *,
  toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
FROM otel.otel_traces;

-- Logs: tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.logs
ENGINE = MergeTree
PARTITION BY toDate(TimestampTime)
ORDER BY (tenant_id, ServiceName, TimestampTime, Timestamp)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
FROM otel.otel_logs
WHERE 1 = 0;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.logs_mv
TO app.logs
AS
SELECT
  *,
  toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
FROM otel.otel_logs;

CREATE TABLE IF NOT EXISTS app.workflow_resource_usage_samples
(
  tenant_id UInt64,
  timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  trace_id String CODEC(ZSTD(1)),
  span_id String CODEC(ZSTD(1)),
  service_name LowCardinality(String) CODEC(ZSTD(1)),
  repository LowCardinality(String) CODEC(ZSTD(1)),
  workflow_name LowCardinality(String) CODEC(ZSTD(1)),
  run_id UInt64 CODEC(ZSTD(1)),
  run_attempt UInt32 CODEC(ZSTD(1)),
  check_run_id UInt64 CODEC(ZSTD(1)),
  job_name LowCardinality(String) CODEC(ZSTD(1)),
  runner_name String CODEC(ZSTD(1)),
  runner_os LowCardinality(String) CODEC(ZSTD(1)),
  runner_arch LowCardinality(String) CODEC(ZSTD(1)),
  sample_interval_seconds UInt32 CODEC(ZSTD(1)),
  cpu_utilization_pct Float64 CODEC(ZSTD(1)),
  memory_used_bytes UInt64 CODEC(ZSTD(1)),
  memory_available_bytes UInt64 CODEC(ZSTD(1)),
  disk_used_bytes UInt64 CODEC(ZSTD(1)),
  disk_available_bytes UInt64 CODEC(ZSTD(1)),
  disk_utilization_pct Float64 CODEC(ZSTD(1)),
  load1 Float64 CODEC(ZSTD(1)),
  INDEX idx_workflow_resource_usage_samples_trace_id trace_id TYPE bloom_filter(0.001) GRANULARITY 1,
  INDEX idx_workflow_resource_usage_samples_check_run_id check_run_id TYPE minmax GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(timestamp)
ORDER BY (tenant_id, repository, workflow_name, job_name, timestamp)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.workflow_resource_usage_samples_mv
TO app.workflow_resource_usage_samples
AS
SELECT
  toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id,
  Timestamp AS timestamp,
  TraceId AS trace_id,
  SpanId AS span_id,
  ServiceName AS service_name,
  ResourceAttributes['vcs.repository.name'] AS repository,
  ResourceAttributes['cicd.pipeline.name'] AS workflow_name,
  toUInt64OrZero(ResourceAttributes['cicd.pipeline.run.id']) AS run_id,
  toUInt32OrZero(ResourceAttributes['everr.github.workflow_run.run_attempt']) AS run_attempt,
  toUInt64OrZero(LogAttributes['everr.resource_usage.check_run_id']) AS check_run_id,
  ScopeAttributes['cicd.pipeline.task.name'] AS job_name,
  if(
    LogAttributes['everr.resource_usage.runner.name'] != '',
    LogAttributes['everr.resource_usage.runner.name'],
    LogAttributes['cicd.worker.name']
  ) AS runner_name,
  LogAttributes['everr.resource_usage.runner.os'] AS runner_os,
  LogAttributes['everr.resource_usage.runner.arch'] AS runner_arch,
  toUInt32OrZero(LogAttributes['everr.resource_usage.sample_interval_seconds']) AS sample_interval_seconds,
  toFloat64OrZero(LogAttributes['everr.resource_usage.cpu.utilization_pct']) AS cpu_utilization_pct,
  toUInt64OrZero(LogAttributes['everr.resource_usage.memory.used_bytes']) AS memory_used_bytes,
  toUInt64OrZero(LogAttributes['everr.resource_usage.memory.available_bytes']) AS memory_available_bytes,
  toUInt64OrZero(LogAttributes['everr.resource_usage.disk.used_bytes']) AS disk_used_bytes,
  toUInt64OrZero(LogAttributes['everr.resource_usage.disk.available_bytes']) AS disk_available_bytes,
  toFloat64OrZero(LogAttributes['everr.resource_usage.disk.utilization_pct']) AS disk_utilization_pct,
  toFloat64OrZero(LogAttributes['everr.resource_usage.load1']) AS load1
FROM otel.otel_logs
WHERE LogAttributes['everr.resource_usage.record_kind'] = 'sample';

CREATE TABLE IF NOT EXISTS app.workflow_resource_usage_job_summaries
(
  tenant_id UInt64,
  timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  trace_id String CODEC(ZSTD(1)),
  span_id String CODEC(ZSTD(1)),
  service_name LowCardinality(String) CODEC(ZSTD(1)),
  repository LowCardinality(String) CODEC(ZSTD(1)),
  workflow_name LowCardinality(String) CODEC(ZSTD(1)),
  run_id UInt64 CODEC(ZSTD(1)),
  run_attempt UInt32 CODEC(ZSTD(1)),
  check_run_id UInt64 CODEC(ZSTD(1)),
  job_name LowCardinality(String) CODEC(ZSTD(1)),
  runner_name String CODEC(ZSTD(1)),
  runner_os LowCardinality(String) CODEC(ZSTD(1)),
  runner_arch LowCardinality(String) CODEC(ZSTD(1)),
  sample_interval_seconds UInt32 CODEC(ZSTD(1)),
  sample_count UInt32 CODEC(ZSTD(1)),
  duration_ms UInt64 CODEC(ZSTD(1)),
  cpu_avg_pct Float64 CODEC(ZSTD(1)),
  cpu_p95_pct Float64 CODEC(ZSTD(1)),
  cpu_max_pct Float64 CODEC(ZSTD(1)),
  memory_avg_used_bytes UInt64 CODEC(ZSTD(1)),
  memory_max_used_bytes UInt64 CODEC(ZSTD(1)),
  disk_peak_used_bytes UInt64 CODEC(ZSTD(1)),
  disk_peak_utilization_pct Float64 CODEC(ZSTD(1)),
  load1_max Float64 CODEC(ZSTD(1)),
  INDEX idx_workflow_resource_usage_job_summaries_trace_id trace_id TYPE bloom_filter(0.001) GRANULARITY 1,
  INDEX idx_workflow_resource_usage_job_summaries_check_run_id check_run_id TYPE minmax GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(timestamp)
ORDER BY (tenant_id, repository, workflow_name, job_name, timestamp)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.workflow_resource_usage_job_summaries_mv
TO app.workflow_resource_usage_job_summaries
AS
SELECT
  toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id,
  Timestamp AS timestamp,
  TraceId AS trace_id,
  SpanId AS span_id,
  ServiceName AS service_name,
  ResourceAttributes['vcs.repository.name'] AS repository,
  ResourceAttributes['cicd.pipeline.name'] AS workflow_name,
  toUInt64OrZero(ResourceAttributes['cicd.pipeline.run.id']) AS run_id,
  toUInt32OrZero(ResourceAttributes['everr.github.workflow_run.run_attempt']) AS run_attempt,
  toUInt64OrZero(LogAttributes['everr.resource_usage.check_run_id']) AS check_run_id,
  ScopeAttributes['cicd.pipeline.task.name'] AS job_name,
  if(
    LogAttributes['everr.resource_usage.runner.name'] != '',
    LogAttributes['everr.resource_usage.runner.name'],
    LogAttributes['cicd.worker.name']
  ) AS runner_name,
  LogAttributes['everr.resource_usage.runner.os'] AS runner_os,
  LogAttributes['everr.resource_usage.runner.arch'] AS runner_arch,
  toUInt32OrZero(LogAttributes['everr.resource_usage.sample_interval_seconds']) AS sample_interval_seconds,
  toUInt32OrZero(LogAttributes['everr.resource_usage.sample_count']) AS sample_count,
  toUInt64OrZero(LogAttributes['everr.resource_usage.duration_ms']) AS duration_ms,
  toFloat64OrZero(LogAttributes['everr.resource_usage.cpu.avg_pct']) AS cpu_avg_pct,
  toFloat64OrZero(LogAttributes['everr.resource_usage.cpu.p95_pct']) AS cpu_p95_pct,
  toFloat64OrZero(LogAttributes['everr.resource_usage.cpu.max_pct']) AS cpu_max_pct,
  toUInt64OrZero(LogAttributes['everr.resource_usage.memory.avg_used_bytes']) AS memory_avg_used_bytes,
  toUInt64OrZero(LogAttributes['everr.resource_usage.memory.max_used_bytes']) AS memory_max_used_bytes,
  toUInt64OrZero(LogAttributes['everr.resource_usage.disk.peak_used_bytes']) AS disk_peak_used_bytes,
  toFloat64OrZero(LogAttributes['everr.resource_usage.disk.peak_utilization_pct']) AS disk_peak_utilization_pct,
  toFloat64OrZero(LogAttributes['everr.resource_usage.load1.max']) AS load1_max
FROM otel.otel_logs
WHERE LogAttributes['everr.resource_usage.record_kind'] = 'job_summary';

-- Optional one-time backfill for rows already present in source tables.
-- Uncomment if needed.
-- INSERT INTO app.traces
-- SELECT *, toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
-- FROM otel.otel_traces;
--
-- INSERT INTO app.logs
-- SELECT *, toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
-- FROM otel.otel_logs;
