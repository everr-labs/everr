# Workflow Resource Usage Metrics Plan

## Goal
Add end-to-end workflow resource usage collection for GitHub Actions jobs and expose the result as tenant-scoped metrics in the collector and ClickHouse.

Starting from `main`, the feature should make it possible to:
- sample runner resource usage while a job is executing
- upload one artifact per job with a stable contract
- fetch those artifacts when a `workflow_run` completes
- convert the artifact contents into OTel metrics
- persist the metrics into ClickHouse behind the existing tenant model

## Scope

In scope:
- a local GitHub Action under `.github/actions/everr-resource-usage`
- workflow instrumentation for the collector CI workflow
- metrics support in `githubactionsreceiver`
- ClickHouse schema and materialized views for resource usage metrics
- collector config changes to enable a metrics pipeline
- tests and docs for the artifact contract and receiver behavior

Out of scope:
- non-Linux sampling
- real-time streaming during job execution
- dashboards or UI work
- making CI fail when sampling or upload fails

## Target Behavior

Each instrumented job should behave like this:

1. After checkout, start a best-effort sampler on Linux runners.
2. Resolve the current job's check run id from the GitHub Actions Jobs API.
3. Write NDJSON samples under `RUNNER_TEMP`.
4. In the action `post` phase, stop the sampler, finalize the artifact payload, and upload it as `everr-resource-usage-v2-<checkRunId>`.
5. When the collector later receives a completed `workflow_run` webhook, fetch the workflow's resource usage artifacts, match each artifact to the corresponding job through `check_run_id`, and emit metrics.
6. Route those metrics through the collector metrics pipeline into ClickHouse, where they are materialized into an app-facing table with row-level security.

The feature is intentionally best-effort:
- unsupported runner OS -> log and skip
- check run discovery failure -> log and skip
- sampler startup failure -> warn and skip
- finalization or upload failure -> warn and skip
- malformed or missing artifacts in the receiver -> warn and skip only that artifact

## Touch Points

Primary code areas:
- `.github/actions/everr-resource-usage/action.yml`
- `.github/actions/everr-resource-usage/package-lock.json`
- `.github/actions/everr-resource-usage/package.json`
- `.github/actions/everr-resource-usage/src/index.ts`
- `.github/actions/everr-resource-usage/src/index.test.ts`
- `.github/actions/everr-resource-usage/scripts/sampler.sh`
- `.github/actions/everr-resource-usage/scripts/finalize.ts`
- `.github/actions/everr-resource-usage/scripts/finalize.test.ts`
- `.github/actions/everr-resource-usage/tsconfig.json`
- `.github/actions/everr-resource-usage/tsconfig.typecheck.json`
- `.github/actions/everr-resource-usage/dist/*`
- `.github/workflows/build-and-test-collector.yml`
- `.gitignore`
- `collector/receiver/githubactionsreceiver/factory.go`
- `collector/receiver/githubactionsreceiver/receiver.go`
- `collector/receiver/githubactionsreceiver/metric_event_handling.go`
- `collector/receiver/githubactionsreceiver/resource_usage_artifact.go`
- `collector/receiver/githubactionsreceiver/resource_usage_artifact_test.go`
- `collector/receiver/githubactionsreceiver/factory_test.go`
- `collector/receiver/githubactionsreceiver/generated_component_test.go`
- `collector/receiver/githubactionsreceiver/internal/metadata/generated_status.go`
- `collector/receiver/githubactionsreceiver/metadata.yaml`
- `collector/receiver/githubactionsreceiver/README.md`
- `collector/semconv/resourceusage.go`
- `infra/config/otel-collector-config.yaml`
- `clickhouse/init/03-create-otel-tables.sql`
- `clickhouse/init/10-create-mvs.sql`
- `clickhouse/init/20-apply-rls.sql`
- `specs/workflow-resource-usage-artifact.md`

## Artifact Contract

The artifact format is the core interface between CI and the collector.

Artifact rules:
- one artifact per job
- name format: `everr-resource-usage-v2-<checkRunId>`
- artifact root contains `metadata.json` and `samples.ndjson`
- schema version is `2`

`metadata.json` must include:
- `schemaVersion`
- `checkRunId`
- `repo`
- `runId`
- `runAttempt`
- `githubJob`
- `sampleIntervalSeconds`
- `startedAt`
- `completedAt`
- `runner.name`
- `runner.os`
- `runner.arch`
- `filesystem.device`
- `filesystem.mountpoint`
- `filesystem.type`

Each `samples.ndjson` row must include:
- `timestamp`
- `cpu.logical[]` with `logicalNumber` and `utilization`
- `memory.limitBytes`
- `memory.usedBytes`
- `memory.availableBytes`
- `memory.utilization`
- `filesystem.device`
- `filesystem.mountpoint`
- `filesystem.type`
- `filesystem.limitBytes`
- `filesystem.usedBytes`
- `filesystem.freeBytes`
- `filesystem.utilization`
- `network.interfaces[]` with `name`, `receiveBytes`, `transmitBytes`
- `load1`

Normalization rules:
- finalization sanitizes the uploaded payload into a stable schema
- CPU logical samples are sorted by `logicalNumber`
- network interfaces are sorted by `name`
- missing sample file finalizes as an empty `samples.ndjson`
- malformed NDJSON should fail finalization with a line-numbered error

## Implementation Plan

### 1. Add a local resource usage action

Create a Node-based local action with `main` and `post` entrypoints:
- `main` starts sampling
- `post` always finalizes and uploads

Action contract:
- default `sample-interval-seconds` is `5`
- default `github-token` is `${{ github.token }}`
- action runtime is `node24`

Main-phase behavior:
- resolve the action root relative to the executing entrypoint instead of relying on `GITHUB_ACTION_PATH`
- short-circuit on non-Linux runners
- discover the current job check run id through the GitHub Actions Jobs API
- create a job-scoped runtime directory under `RUNNER_TEMP/everr-resource-usage/<runId>-<runAttempt>-<githubJob>`
- spawn `scripts/sampler.sh` detached, persist its pid, and store all required state via `saveState`

Post-phase behavior:
- no-op if `main` never enabled collection
- ensure the samples file exists even if the sampler produced nothing
- stop the sampler with `SIGTERM`
- resolve the workspace filesystem metadata via `df -PkT`
- run `dist/finalize.mjs` to materialize `metadata.json` and sanitized `samples.ndjson`
- upload the two files as a single artifact with `retentionDays: 7`

Failure policy:
- every failure path logs a warning instead of failing the job

### 2. Implement check run discovery

The action must map the current running job to its check run id.

Discovery requirements:
- call the workflow jobs endpoint for the current `run_id` and `run_attempt`
- use the default GitHub API URL unless `GITHUB_API_URL` overrides it
- include the standard GitHub API headers and bearer token

Matching strategy:
- derive name hints from both `GITHUB_JOB` and the workflow YAML job `name`
- prefer active jobs over completed jobs
- if `RUNNER_NAME` is available, prefer jobs on that runner
- if job-name hints produce one match, use it immediately
- otherwise prefer the single `in_progress` candidate
- otherwise pick the job whose `started_at` is closest to `now`

This step is why the action must run after checkout: it needs the local workflow file to resolve the declared job name.

### 3. Implement Linux sampling and artifact finalization

`scripts/sampler.sh` should:
- read CPU counters from `/proc/stat`
- emit an initial sample with zero CPU utilization so later samples can be delta-based
- read memory usage from `/proc/meminfo`
- read filesystem info for the workspace mount from `df -PkT`
- read network counters from `/proc/net/dev`
- exclude loopback from network samples
- read 1-minute load average from `/proc/loadavg`
- append one JSON line per interval to `samples.ndjson`

`scripts/finalize.ts` should:
- parse CLI args for metadata and paths
- sanitize and normalize all values before writing the final artifact
- write pretty-printed `metadata.json`
- rewrite `samples.ndjson` in normalized order

### 4. Instrument workflows that should publish artifacts

Update `.github/workflows/build-and-test-collector.yml` so each targeted job:
- grants `actions: read`
- retains `contents: read`
- adds `uses: ./.github/actions/everr-resource-usage` immediately after checkout

Repository hygiene:
- keep the action bundle under version control
- allowlist `.github/actions/everr-resource-usage/dist/**` in the root `.gitignore`

### 5. Extend `githubactionsreceiver` to emit metrics

Add metrics support to the receiver factory and generated metadata:
- register `receiver.WithMetrics(...)`
- expose `MetricsStability = alpha`
- include metrics in generated lifecycle tests and README/metadata docs
- add semconv constants for resource usage attribute keys and the custom load metric name

Receiver runtime changes:
- add `metricsConsumer` to the shared receiver instance
- lazily create one installation-scoped GitHub client per request and reuse it for metrics and logs
- only emit resource usage metrics for completed `workflow_run` events
- keep reusing the existing workflow-run resource attributes so repository, workflow, run, and tenant context remain aligned with traces/logs

### 6. Implement artifact ingestion in the receiver

When a completed workflow run is received:
- list all workflow artifacts
- filter to the `everr-resource-usage-v2-` prefix
- ignore expired artifacts
- if multiple artifacts exist for the same check run, keep the most recently updated one
- list workflow jobs for the run and index them by `check_run_url`
- download each artifact archive with a hard size cap of `64 MiB`

Artifact validation rules:
- `metadata.json` must exist and decode with unknown fields rejected
- `schemaVersion` must equal `2`
- `checkRunId` must be valid and match a workflow job
- `samples.ndjson` must exist and parse line by line
- malformed artifacts are skipped individually

### 7. Map artifact samples to OTel metrics

Emit the following metrics:
- gauge: `system.cpu.utilization`
- sum: `system.memory.limit`
- sum: `system.memory.usage`
- sum: `system.linux.memory.available`
- gauge: `system.memory.utilization`
- sum: `system.filesystem.limit`
- sum: `system.filesystem.usage`
- gauge: `system.filesystem.utilization`
- sum: `system.network.io`
- gauge: `everr.resource_usage.load.1m`

Metric semantics:
- CPU emits one point per logical CPU with `cpu.logical_number`
- memory usage uses `system.memory.state=used`
- filesystem usage emits both `used` and `free` states
- filesystem limit/utilization carry device, mountpoint, and filesystem type attributes
- network IO is emitted as cumulative receive/transmit counters per interface after subtracting the first observed sample as the baseline
- load average is a gauge

Shared metric attributes:
- `everr.resource_usage.check_run_id`
- `everr.resource_usage.sample_interval_seconds`
- `cicd.pipeline.task.name`
- `cicd.worker.name`
- `everr.resource_usage.runner.os`
- `everr.resource_usage.runner.arch`
- runner group and runner labels when available

Timestamp policy:
- start timestamp comes from artifact `startedAt`, falling back to job start/completion timestamps
- point timestamp comes from each sample `timestamp`, falling back to job completion time

### 8. Persist metrics into ClickHouse

Raw storage:
- create `otel.otel_metrics_gauge`
- create `otel.otel_metrics_sum`

App-facing storage:
- create `app.workflow_resource_usage_metrics`
- store tenant id, run identity, check run id, job name, runner identity, metric identity, value, temporality flags, and the raw resource/metric attribute maps

Materialized views:
- one MV for gauge metrics from `otel.otel_metrics_gauge`
- one MV for sum metrics from `otel.otel_metrics_sum`
- filter to the exact resource usage metric names listed above
- extract repository, workflow name, run id, run attempt, check run id, runner OS/arch, and sample interval from the OTel attributes

Security:
- add a row policy so `app_ro` can only read rows where `tenant_id` matches `SQL_everr_tenant_id`

### 9. Enable the collector metrics pipeline

Update `infra/config/otel-collector-config.yaml` so the collector service has:
- `metrics` pipeline
- receiver: `githubactions`
- processors: `resource`, `batch`
- exporters: `clickhouse`, `debug`

### 10. Cover the feature with tests and docs

Action tests should cover:
- artifact naming
- runtime path layout
- action root resolution
- workflow path parsing
- check run id parsing and selection
- workflow job name discovery from local YAML
- check run discovery through the Jobs API
- Linux-only behavior
- sampler startup failure downgrade
- finalize/upload success path
- finalize/upload failure downgrade

Finalizer tests should cover:
- metadata generation
- sample sanitization and sorting
- missing sample file
- malformed NDJSON with line-numbered error

Receiver tests should cover:
- metrics receiver creation
- end-to-end `workflow_run` -> artifact -> metrics conversion
- latest-artifact selection per check run id
- invalid artifact skip paths
- non-completed workflow run skip path

Docs to update:
- receiver README and metadata stability
- artifact contract spec under `specs/`

Generated outputs:
- rebuild and commit `.github/actions/everr-resource-usage/dist/*`
- regenerate receiver-generated metadata files if the project uses generation tooling for that path

## Suggested Delivery Order

1. Add the action, sampler, finalizer, and Node tests.
2. Instrument the collector workflow and commit the built action bundle.
3. Add metrics support to `githubactionsreceiver`.
4. Add artifact ingestion and metric mapping tests in the receiver.
5. Add ClickHouse metric tables, MVs, and row policy.
6. Enable the collector metrics pipeline.
7. Update docs and generated metadata files.

## Acceptance Criteria

- Running an instrumented Linux job uploads exactly one `everr-resource-usage-v2-<checkRunId>` artifact with `metadata.json` and `samples.ndjson`.
- Sampling or upload failures do not fail CI jobs.
- Completed `workflow_run` webhooks produce resource usage metrics when the matching artifacts exist.
- Metrics include enough attributes to identify tenant, workflow, run, check run, job, runner, filesystem, and network interface dimensions.
- ClickHouse stores the resulting metrics in `app.workflow_resource_usage_metrics`.
- `app_ro` access to those rows is tenant-scoped by row-level security.
- Focused action and receiver tests pass.

## Review Checklist

- Check that artifact identity is anchored on `checkRunId`, not job name alone.
- Check that the action is safe to add to CI because every failure mode is best-effort.
- Check that receiver artifact matching is deterministic for reruns and duplicate artifacts.
- Check that metric types and attributes align with the intended OTel semantics.
- Check that the ClickHouse MVs only admit the intended metric names and keep tenant attribution intact.
- Check that the committed `dist/` bundle matches the TypeScript sources.
