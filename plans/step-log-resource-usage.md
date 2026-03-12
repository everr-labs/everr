# Step Log Resource Usage Plan

## Goal
Show job-level resource usage in the run details UI when a user opens a step log, and highlight the exact time window in which the selected step executed.

## Summary
- Add a resource usage panel above the step log viewer in the Jobs tab.
- Use the existing job-level telemetry already ingested from resource usage artifacts.
- Keep logs primary; the resource panel is supporting context.
- Highlight the selected step execution window across every time-series chart.

## Product Decisions
- Resource usage is job-level, not step-level.
- The UI should make that explicit while a step is selected.
- V1 includes full telemetry already collected:
  - CPU
  - memory
  - filesystem
  - network
  - load average
- Network is displayed as cumulative bytes since job start, not per-second throughput.
- Runs without telemetry should show a quiet empty state and still render logs normally.

## Data Changes
- Extend the internal `Step` model to include:
  - `startTime` (Unix ms)
  - `endTime` (Unix ms)
- Add a new internal `JobResourceUsage` model with:
  - `points[]` keyed by timestamp
  - aggregated CPU avg and CPU max
  - memory used/limit/utilization
  - filesystem used/limit/utilization
  - network receive/transmit cumulative bytes
  - `load1`
  - summary values for current and peak metrics
  - `sampleIntervalSeconds`

## Backend / Query Plan
- Add a new server function in the runs data layer:
  - `getJobResourceUsage({ traceId, jobId })`
- Resolve the selected job from traces using `traceId + jobId`.
- Query ClickHouse metrics tables for the matching run/job telemetry.
- Aggregate raw metric rows by timestamp:
  - CPU: average and max across logical cores
  - memory: used, limit, utilization
  - filesystem: used, limit, utilization
  - network: sum receive/transmit across interfaces
  - load: raw `load1`
- Return normalized chart points plus summary stats.
- Do not require a new public API route; keep this inside the app data layer.

## UI Plan
- Update the step detail route to prefetch resource usage with logs.
- Render a compact resource usage section above `LogViewer`.
- Use a responsive chart grid with summary stats and charts for:
  - CPU
  - memory
  - filesystem
  - network
  - load
- Add a shared highlighted band for the selected step window on each chart.
- Clamp the highlight to the available chart range when telemetry starts after the step starts or ends before the step ends.
- Label the highlighted span as `Step window`.
- Add shared formatters for:
  - bytes
  - percentages
  - time-of-day tooltip/axis labels

## Testing
- Add data-layer tests for:
  - timestamp aggregation
  - CPU avg/max rollup
  - network interface summation
  - summary derivation
  - empty telemetry handling
- Add component tests for:
  - populated resource panel
  - empty state
  - step window highlight rendering
- Add step-detail regression coverage so logs still render when:
  - telemetry is missing
  - the resource query returns no rows
  - the resource query fails

## Acceptance Criteria
- Opening a step shows job resource usage above logs when telemetry exists.
- The selected step’s execution window is visibly highlighted on every chart.
- Switching steps updates both the highlight and the displayed context.
- Runs without resource telemetry still show logs without layout breakage.

## Assumptions
- Existing resource usage ingestion remains unchanged.
- Highlighting uses step timestamps from traces, not log-derived timestamps.
- No step-level resource attribution is introduced in this change.
