# Align Collector With Upstream GitHub Receiver

## What
Track the remaining differences between our `githubactionsreceiver` and the upstream `opentelemetry-collector-contrib/receiver/githubreceiver` and decide which to adopt.

## Why
Staying close to the upstream reduces maintenance burden and makes it easier to pull in future improvements. Some differences are intentional (e.g. our trace ID includes repository ID), others are accidental drift.

## Differences

### Already adopted
- **`correctActionTimestamps`** — zero/reversed timestamp guard (our version also handles zero times, which upstream misses)
- **SpanKind** — jobs and steps now use `SpanKindInternal` instead of `SpanKindServer`
- **Parent span status from job conclusion** — use `job.GetConclusion()` directly instead of iterating steps. The old step-iteration approach incorrectly marked jobs as `Error` when a `continue-on-error` step failed.

### Worth considering
- **Duplicate step names** — upstream deduplicates with `newUniqueSteps` (appends `-n` suffix). We don't, so duplicate step names produce ambiguous spans in the waterfall. Low effort, no breaking change.
- **Queue span** — upstream emits a `queue-{jobName}` child span for queue time. Tracked separately in `todo/ideas/queue-span-for-workflow-jobs.md`.

### Intentional divergences (keep as-is)
- **TraceID generation** — we include `repositoryID` (`{repoID}@{runID}#{runAttempt}`), upstream doesn't (`{runID}{runAttempt}t`). Ours prevents collisions across repos with the same run IDs.
- **Parent span timestamps** — we use `started_at → completed_at` (matches GitHub billing window), upstream uses `created_at → completed_at` (includes queue time in job duration). Ours is better for cost accuracy.
- **StatusMessage mapping** — we normalize conclusions (`skipped→skip`, `cancelled→cancellation`) via `mapConclusion`. Upstream passes raw GitHub values. Our downstream queries depend on the mapped values, so changing this would require a migration.

## Upstream reference
`opentelemetry-collector-contrib/receiver/githubreceiver` — `trace_event_handling.go`

## Rough appetite
Small per item — each difference can be adopted independently.
