# Collector pod memory spike

The **collector-oom** alert fires when a pod in the `collector` namespace
peaks above **1024 MiB** working set over the last 5 minutes. Baseline is
65-150 MiB, so a firing alert means memory grew by an order of magnitude.

The known driver is GitHub Actions log ingestion: a `workflow_run: completed`
webhook makes the collector download and parse the run's full log archive.
The protections added after the
[2026-07-04 investigation](./investigations/collector-webhook-oom.runbook.md)
are assumed to be in place:

- the collector container has memory requests and limits, and the pipeline
  has a `memory_limiter` processor, so overload produces backpressure instead
  of a kernel OOM kill,
- log ingestion emits in bounded chunks (10k records per payload), so no
  single run is materialized in memory at once. Processing is still
  synchronous in the webhook handler and the app allows it 60 seconds, so
  replay durations up to a minute are expected for huge runs, not a
  regression.

With those in place this alert should be rare. If it fires, one of the
protections is not doing its job or the load pattern changed. Work through
the steps below.

## 1. Confirm the spike and find the pod

```panel
ref: collector-memory
height: 300
```

A single scrape in the GiB range is a fast balloon (one huge ingest). A slow
climb across hours is different: suspect a leak or genuinely higher
steady-state load.

## 2. What was the collector ingesting?

```panel
ref: slow-replays
height: 280
```

```panel
ref: slow-by-event-type
height: 240
```

Since 2026-07-04 the app's replay spans
(`github_events.jobs.replay_webhook_to_collector`) carry
`github.repository.full_name`, `github.workflow_run.id`,
`github.workflow_run.name`, and `everr.organization.id`, so the slow
replay in the panel above names the run directly. As a fallback,
identify the run on the pod itself:

```sh
kubectl logs -n collector <pod> | grep "Processing WorkflowRunEvent"
```

This prints repo, workflow name, and run id. Check the run's size with
`gh run view <run-id> -R <repo> --json jobs`: a huge build matrix with
verbose logs is the classic trigger.

## 3. Did the protections hold?

- **Webhook latency.** Ingestion is synchronous, so replay durations scale
  with archive size; up to the 60s app timeout is expected for huge runs.
  What matters is memory staying flat while a slow replay is in flight. A
  slow replay together with a memory balloon means chunked emission is not
  bounding the payload (regression):

```panel
ref: replay-durations
height: 240
```

- **Container state.** `kubectl describe pod -n collector <pod>`. If
  `Last State` shows `OOMKilled`, check which limit was hit: a kill at the
  configured container limit means the `memory_limiter` soft limit is set too
  close to (or above) the container limit and never engaged. No limits shown
  at all means the deployment lost its resource settings.
- **Backpressure.** `kubectl logs -n collector <pod> | grep -i "memory"`
  should show the `memory_limiter` refusing data during the spike. Refusals
  are the mechanism working; sustained refusals mean the collector is
  undersized for current load.
- **Data loss.** If the pod restarted, telemetry batched but not yet exported
  was lost. Check for a gap in ingestion around the restart across all
  signals, not just CI data.

## 4. Decide the action

| Finding | Action |
| --- | --- |
| One pathological workflow run, protections held, no restart | Nothing urgent. Note the repo/run; consider a per-run size guard if it repeats. |
| Replay durations spiky again, or whole runs buffered in memory | Regression in the receiver. Compare the deployed collector image against main and roll back or fix. |
| OOMKilled at the container limit, memory_limiter never engaged | Fix the `memory_limiter` soft/hard limits so they sit safely below the container limit. |
| No container limits present | Restore memory requests/limits in the collector deployment (everr-deploy). |
| Sustained high memory with steady refusals | Load outgrew the sizing. Raise the container limit and the memory_limiter thresholds together, then raise the alert threshold in `collector-oom.alert.yaml` to keep headroom. |

## Related

- [Investigation (2026-07-04)](./investigations/collector-webhook-oom.runbook.md):
  the original incident analysis, root cause in the
  `githubactionsreceiver`, and the fixes this runbook assumes are deployed.
