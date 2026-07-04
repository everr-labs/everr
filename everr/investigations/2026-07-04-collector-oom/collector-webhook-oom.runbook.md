# Collector OOM kills from workflow_run log ingestion

Investigation from **2026-07-04**. At the time, the collector pod was getting
kernel OOM killed roughly once every few hours, each time right after
ingesting the logs of a large GitHub Actions run. This page records the
analysis and the fixes that came out of it. The
[collector-oom triage runbook](../../collector-oom.runbook.md) assumes those
fixes are deployed; read this page for the background.

**Update, 2026-07-04:** the collector has been released with the current
image (fix 1). The **collector-webhook-failures** alert
(`everr/investigations/2026-07-04-collector-oom/collector-webhook-failures.alert.yaml`) now checks every 30 minutes
that the webhook 500s this release eliminates have not come back.

**Update, 2026-07-04 (later):** the collector-oom alert fired twice more,
at 04:55 UTC (8.3 GiB, old image) and at 10:30 UTC (10 GiB, on the pod
running the new image released around 09:25). Each spike coincides with a
single `workflow_run` replay taking over 20 seconds (26.9s at 04:55:35,
22.4s at 10:33:52), so the synchronous inline ingestion (fix 3, not yet
implemented) is still the driver; fix 1 was never expected to address it.
The offending run could not be identified from the everr tenant: the app's
replay span recorded only the event type and job id, no repo or run id,
and the run does not appear in our tenant's ingested CI logs. Querying the
affected customer's tenant identified both occurrences as the same Rust
cross-compilation workflow from the original analysis (customer repo and
run ids intentionally not recorded here); the second run ended at
10:33:51, one second before the 22.4s replay began. Notably, that
workflow's runs have pipeline trace spans but zero ingested log lines, in
both occurrences the log payload died with the collector.
The app-side replay span now records
`github.repository.full_name`, `github.workflow_run.id`,
`github.workflow_run.name`, `github.workflow_run.run_attempt`,
`github.event.action`, and `everr.organization.id`
(`packages/app/src/server/github-events/tasks.ts`), so the next slow
replay names its run directly.

## Status at the time vs now

The left tile of each pair is pinned to the incident window (2026-07-03 17:00
to 2026-07-04 05:30 UTC); the right tile follows the time picker, so with a
recent window selected these read as a direct then-vs-now comparison.

```panel
ref: memory-then-vs-now
height: 160
```

```panel
ref: replay-then-vs-now
height: 160
```

During the incident window there were 4 replay jobs over 5 seconds, all
`workflow_run` events, each followed by a collector restart about a minute
later:

```panel
ref: incident-slow-replays
height: 240
```

Collector memory baseline is 65-150 MiB. The scrapes right before each kill
were in the GiB range, topping out above 12 GiB:

```panel
ref: incident-memory-scrapes
height: 300
```

## Compare with now

The same signals, following the time picker. After the fixes these should
show a flat memory baseline and replay durations in the low milliseconds.

```panel
ref: collector-memory
height: 280
```

```panel
ref: replay-durations
height: 240
```

## What actually happens

The app replays the GitHub webhook to
`http://collector.collector.svc.cluster.local:8080/webhook/github`. For a
`workflow_run: completed` event, the collector's `githubactionsreceiver`
did all of this synchronously inside the HTTP handler
(`collector/receiver/githubactionsreceiver/log_event_handling.go`):

1. downloads the run's full log archive from GitHub (capped at 256 MB),
2. unzips it and scans every line of every job log,
3. materializes the entire run as one in-memory `plog.Logs` payload,
4. only then returns 202.

The trigger for the investigated occurrence (trace
`158b2012078cbbbc6c5438fcee5a350b`, 26.9s) was a customer repository's
23-job Rust cross-compilation matrix with very verbose cargo output
(customer repo and run id intentionally not recorded here). Steps 1-3 are
the 27 seconds the app's replay job saw.

The memory allocated while building that payload was the kill: the container
had no memory requests or limits and the pipeline had no `memory_limiter`
processor, so nothing pushed back before the kernel OOM killer shot the
process.

## Why this matters beyond latency

The collector returns 202 for the event and then dies. Anything batched but
not yet exported to ClickHouse at kill time is silently lost, including
telemetry from unrelated tenants that happened to be in flight.

## The alert that came out of this

The **collector-oom** alert (`everr/collector-oom.alert.yaml`) fires when any
pod in the `collector` namespace exceeds **1024 MiB** working set over the
last 5 minutes. Baseline never passes 150 MiB and every observed pre-kill
spike was multi-GiB, so the threshold catches the balloon while it is
happening. Triage steps live in the
[collector-oom runbook](../../collector-oom.runbook.md).

We could not alert on the OOM kill itself: the internal kubelet-stats
collector only exports cpu/memory/filesystem gauges. There is no
`k8s.container.restarts` metric, no Kubernetes events, and the collector's own
stdout logs are not ingested. See fix 4.

## How the incident was verified at the time

- The slow replays and their traces: the pinned slow replays panel above;
  each trace shows a single POST to the collector accounting for the whole
  duration.
- The kill: `kubectl describe pod -n collector <pod>` showed
  `Last State: Terminated, Reason: OOMKilled` about a minute after each slow
  replay.
- The run being ingested: `kubectl logs -n collector <pod> --previous | grep
  "Processing WorkflowRunEvent"` shows repo, workflow name, and run id.

## Fixes

1. **Deploy the current collector image.** Released 2026-07-04. Production
   ran `a0ef8d96` (2026-06-23). `f114d040` stops the receiver from erroring
   on runs with no log archive (27 "Failed to get logs: 404" per container at
   the time, each causing the app to retry the event), and main also treats
   continuation lines as continuations instead of error-logging and dropping
   them. The collector-webhook-failures alert verifies the 500s stay gone.
2. **Bound the collector's memory.** Set container memory requests and limits
   in the deployment and add a `memory_limiter` processor to the pipeline
   (it was only `resource, batch`). Overload should degrade with backpressure
   on the webhook, not a kernel kill that drops accepted data from every
   tenant.
3. **Decouple ingestion from the webhook response.** Return 202 immediately
   and process the log archive asynchronously, and emit logs per job (or per
   file) instead of building the whole 23-job run as one `plog.Logs` payload.
   The 256 MB cap bounds the compressed download, not the decoded pdata size.
   **Update, 2026-07-04:** the emit half is done. The receiver now hands
   payloads to the pipeline in bounded chunks, capped at 10k records or
   4 MiB of body text (`logEmitter` in
   `collector/receiver/githubactionsreceiver/log_event_handling.go`), so
   memory stays proportional to one chunk instead of the whole run.
   Processing is still synchronous in the webhook handler; the app's replay
   timeout was raised from 30s to 60s to cover big archives. The async half
   remains open.
4. **Add a real restart signal.** Add a `k8s_cluster` receiver (or ingest
   Kubernetes events) to the internal collector in
   `everr-deploy/infra-v2/config/otel-collector-internal-config.yaml` so we
   get `k8s.container.restarts`, then alert on restart increases directly
   instead of on the memory precursor.

## Minor findings from the same investigation

- The deployed receiver dropped log lines whose timestamp starts with a UTF-8
  BOM ("Failed to parse timestamp"). Main no longer drops them, but it strips
  the BOM only on the first line of each file, while GitHub's combined log
  format has one BOM per step section, so those lines still parse as
  continuations with the raw timestamp left in the body.
- The `everr-collector` service emits no self-telemetry (no metrics, no
  ingested logs). Worth adding its own OTLP export so incidents like this are
  visible without `kubectl`.
