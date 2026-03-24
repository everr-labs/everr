# Queue Span for Workflow Jobs

## What
Emit a dedicated span representing the time a job spends queued (created → started) instead of computing queue time client-side from resource attributes.

## Why
- Makes queue time a first-class entity in the trace waterfall, visible without custom logic
- Enables ClickHouse queries to aggregate queue durations directly (e.g. P95 queue time per runner label) without joining resource attributes
- Aligns with the upstream OTEL GitHub receiver which already ships a `queue-{jobName}` span with a `cicd.pipeline.run.queue.duration` attribute
- Our current approach computes queue time in the app layer (`packages/app/src/data/runs/server.ts`, `getRunSpans`) by diffing `created_at` and `started_at` resource attributes — this works but can't be queried or alerted on at the data layer

## Upstream reference
The upstream collector (`opentelemetry-collector-contrib/receiver/githubreceiver`) implements this in `createJobQueueSpan`. It creates a child span of the job span with:
- Name: `queue-{jobName}`
- Timestamps: `created_at → started_at`
- Attribute: `cicd.pipeline.run.queue.duration` (nanoseconds)

## Rough appetite
Small — the span creation is straightforward, but we'd want to update the waterfall UI to render queue spans distinctly and remove the client-side queue time computation.

## Notes
- Would need a way to visually distinguish queue spans from execution spans in the trace waterfall
- Consider whether the app-layer queue time computation should be kept as a fallback for historical data or removed entirely
