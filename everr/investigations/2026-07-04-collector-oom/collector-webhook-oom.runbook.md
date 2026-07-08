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

**Update, 2026-07-04 (post-release recurrence):** the chunked emitter
(fix 3's emit half, image `b78b1fc3`, deployed 13:15 UTC) did not stop the
ballooning. The new pod spiked to 6.7 GiB at 14:05 UTC and 4.3 GiB at
14:35 UTC while ingesting the same cross-compilation workflow. The
analysis of this recurrence found two remaining drivers, recorded in
[Where the memory actually lives](#where-the-memory-actually-lives) and
[The retry storm multiplier](#the-retry-storm-multiplier) below. In short:
the chunks now pile up in the ClickHouse exporter's sending queue instead
of the receiver, and the app's 30-second replay timeout plus job retries
run several full ingestions of the same run concurrently.

**Update, 2026-07-04 (resolution):** rather than keep hardening the
streaming path, chunked emission was reverted entirely in favor of a
simple **15 MiB cap on the compressed log archive** (fix 7). Runs over the
cap skip log ingestion (traces and metrics still flow); runs under it are
small enough that the original whole-run payload is harmless. The 60s app
replay timeout was also reverted to 30s: it never had an effect, since the
collector server's own `WriteTimeout` is 30s.

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

## Where the memory actually lives

Analysis of the post-release recurrence (14:05 UTC spike on the pod running
`b78b1fc3`). Measured on a representative run of the offending workflow: the
log archive is 85 MiB compressed, decoding to 572 MB of text across 367
files and 11.2 million lines. The chunked emitter turns that into roughly
1,120 payloads of 10k records each, so the receiver itself now holds only
one chunk at a time. The fix bounded the receiver, not the process:

- The logs pipeline is `resource, batch -> clickhouse`. The `batch`
  processor is asynchronous: it accepts a chunk, returns immediately, and
  passes batches on later. Any error it hits downstream is logged and the
  batch is dropped; no backpressure ever reaches the receiver.
- The ClickHouse exporter (clickhouseexporter v0.152.0) defaults to a
  sending queue of **1,000 requests, sized by request count, not bytes**,
  with `block_on_overflow: false` and 10 insert consumers. A 10k-record
  chunk is about 4 MB of pdata, so the queue alone can absorb about 4 GiB,
  nearly the entire run.
- The scan reads a local temp file and produces chunks far faster than the
  insert consumers drain them, so for a large run the queue simply fills to
  capacity. The whole-run materialization moved from the receiver into the
  exporter queue.

Two visible consequences confirm this. The memory spikes match the queue
math (6.7 GiB with overlapping attempts, see below). And once the queue is
full, the batch processor drops what it cannot enqueue: in the 14:05 to
14:30 window, only about 16k of the run's 11.2 million log lines landed in
ClickHouse.

```panel
ref: post-release-memory-scrapes
height: 300
```

## The retry storm multiplier

The replay spans changed shape after the release. Before it, `workflow_run`
replays completed in 22 to 29 seconds with status Unset. After it, every
replay of the large run fails at exactly 30.0 seconds with status Error,
repeatedly, in a backoff pattern: 8 attempts between 14:04 and 14:37 UTC.

```panel
ref: post-release-slow-replays
height: 280
```

The mechanics:

1. The deployed app still aborts replays at 30 seconds
   (`replayTimeoutMs: 30_000`; the raise to 60s exists on main but was not
   deployed, and the collector's own HTTP server has `WriteTimeout: 30s`,
   which caps the response window regardless of the app's timeout).
2. When the app aborts, the collector does not stop: after the archive
   download nothing in the scan-and-emit path checks the request context,
   so each aborted attempt keeps scanning and queueing for minutes.
3. The app marks the job failed and graphile-worker retries it with
   backoff (up to `maxAttempts: 10`), starting a **new full ingestion
   while the previous ones are still running**. Overlapping attempts stack
   their queue usage, which is how a run whose queue footprint is about
   4 GiB produced 6.7 GiB and later 4.3 GiB spikes.

The archive size cap (fix 7) removes the storm's precondition: an
oversized run's log ingestion is skipped after at most a 15 MiB download,
and runs under the cap finish well inside the 30s response window, so
replays succeed on the first attempt and there is nothing to retry. A
single-flight guard in the receiver (fix 6) was prototyped as an
alternative but dropped in favor of the cap's simplicity.

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
   **Update, 2026-07-04 (post-release):** released as `b78b1fc3` and
   confirmed insufficient on its own; the chunks pile up in the exporter's
   sending queue instead (see
   [Where the memory actually lives](#where-the-memory-actually-lives)).
   Note the 60s app timeout is also capped by the collector server's own
   `WriteTimeout: 30s`, so raising it never had any effect.
   **Update, 2026-07-04 (resolution):** chunked emission reverted and the
   app timeout restored to 30s; superseded by the archive size cap (fix 7).
   The async half is no longer needed for memory safety, though it remains
   the right long-term shape for webhook handling.
4. **Add a real restart signal.** Add a `k8s_cluster` receiver (or ingest
   Kubernetes events) to the internal collector in
   `everr-deploy/infra-v2/config/otel-collector-internal-config.yaml` so we
   get `k8s.container.restarts`, then alert on restart increases directly
   instead of on the memory precursor.
5. **Make the pipeline backpressure the receiver.** From the post-release
   recurrence. Configure the ClickHouse exporter's `sending_queue` with a
   small size and `block_on_overflow: true`, and drop the `batch` processor
   from the logs pipeline so `ConsumeLogs` blocks when the queue is full
   and the scan self-paces at insert speed. Not pursued: superseded by the
   archive size cap (fix 7), which keeps whole-run payloads small enough
   that queue buffering is harmless.
6. **Deduplicate run ingestion (single-flight).** From the post-release
   recurrence. Claim each `(repository, run id, run attempt)` before
   processing so a sender retry cannot start an overlapping ingestion of
   the same run. Prototyped and dropped: with fix 7 in place replays finish
   inside the response window, so the retry storm has no trigger.
7. **Cap the log archive size.** The applied resolution. The receiver
   downloads at most 15 MiB (+1 byte) of the compressed archive; if the
   archive is bigger, it skips log ingestion for that run with a "Log
   archive exceeds size cap" warning naming the repo and run, and the event
   still succeeds so the sender does not retry (the run keeps its trace
   spans and metrics). GitHub streams the archive without a Content-Length
   and rejects HEAD and range requests, so the check happens during the
   download, bounding the wasted transfer at 15 MiB. Chunked emission
   (fix 3's emit half) was reverted at the same time: under the cap the
   original whole-run payload stays comfortably small.

## Minor findings from the same investigation

- The deployed receiver dropped log lines whose timestamp starts with a UTF-8
  BOM ("Failed to parse timestamp"). Main no longer drops them, but it strips
  the BOM only on the first line of each file, while GitHub's combined log
  format has one BOM per step section, so those lines still parse as
  continuations with the raw timestamp left in the body.
- The `everr-collector` service emits no self-telemetry (no metrics, no
  ingested logs). Worth adding its own OTLP export so incidents like this are
  visible without `kubectl`.
