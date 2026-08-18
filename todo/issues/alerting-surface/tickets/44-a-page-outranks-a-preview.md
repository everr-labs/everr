# 44: A page outranks everything that cannot page

**What to build:** The alerting jobs run in a stated order of importance
instead of first-come-first-served. Demo: queue 200 preview evaluations, then
fire one live alert. The notification goes out without waiting for the
previews to drain.

**Details:** found 2026-08-11, from the question "should preview rules have
lower priority than live ones". They should, but preview is only the bottom of
an order that does not exist yet, and the half that pages someone late is
higher up.

`WORKER_CONCURRENCY = 2` (`server/worker/runtime.ts`). The 64 partition queues
from `alertingPartitionQueue` bound what may run in parallel, but two slots per
process is what actually runs, and every alerting job competes for them:
evaluation, `process-event`, `flush-group`, `send-delivery`, the lifecycle
projection and the retention sweep. Only `evaluate` and `flush-group` carry a
queue name at all; the rest go straight into the general pool.

Every one of them enqueues at `priority` 0, so Graphile's selection order
(`priority`, then `run_at`, then `id`) falls through to arrival time. A backlog
of preview evaluations enqueued at 10:00:00 is selected ahead of a live alert's
`send-delivery` enqueued at 10:00:01. Preview work does not merely delay
preview results; it delays the page.

**The order to state:**

1. `send-delivery`. The page itself.
2. `flush-group`, `process-event`. Composing the page.
3. `scan`, live `evaluate`. Detection. `scan` belongs here rather than lower
   because it is cheap and everything else depends on it running.
4. `project-lifecycle`. History that must land, but nobody is waiting on it.
5. Preview `evaluate`. A development convenience that never notifies.
6. `retention`. Housekeeping with no deadline.

**Where the writes go:** `priority` is already plumbed.
`addWorkerJobInTransaction` passes `spec.priority ?? 0` to
`graphile_worker.add_job`, and `TaskSpec.priority` covers the `addWorkerJob`
path. The preview split is two sites, `evaluationTaskSpec`
(`scheduling/evaluation-jobs.server.ts`) and `scheduleAlertAtInTransaction`
(`evaluation/rule.ts`), keyed on the definition having a `previewId`.

**Two decisions the numbers force:**

- Lower wins, and every other job in the application sits at 0. Putting
  `send-delivery` below 0 jumps it ahead of previews, ingestion and everything
  else, not just ahead of alerting work. That is probably right for a page and
  certainly wrong for retention, so the levels have to be chosen against the
  whole application's jobs, not against each other.
- Leave gaps between levels. A level inserted later must not require
  renumbering the ones already in the database.

**What this does not fix, and must not be sold as fixing:** priority orders
selection, not preemption. A running job holds its slot until it returns. A
preview query may run for the 30 seconds the SQL API profile allows, and the
retention sweep may run for the five minutes `CLEANUP_BUDGET_MS` allows, and
with two slots either can stall delivery for that whole time whatever its
priority says. The real fix is separate lanes so evaluation and maintenance
cannot hold a delivery slot, which is already written down in
[`../../ideas/alert-evaluation-capacity.md`](../../ideas/alert-evaluation-capacity.md):
"keep notification and maintenance jobs outside those lanes so slow queries
cannot block delivery work". This ticket is the cheap part of that, available
today. Raising `WORKER_CONCURRENCY` is not the fix either: it multiplies
concurrent ClickHouse queries per organization, which the SQL API profile caps
at 20 anyway.

**The cost of deprioritizing previews.** Under sustained load a preview
evaluation starves, and a preview with no firing instances reads as "this rule
would not have fired". That is a false negative in the one surface whose whole
job is to predict behaviour. Evaluation lateness has to be visible on the
preview before the priority split lands, not after. The rollup carries
`next_evaluation_at`, and a stamp in the past is what says a rule is overdue.

`EVERR_PREVIEW_ALERTS=off` is unaffected and stays what it is: the emergency
lever for shedding preview load entirely.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] The order is declared in one place, as data, not spread across the
      enqueue sites
- [ ] A queued page is never selected behind work that cannot page
- [ ] Preview evaluation yields to live evaluation
- [ ] The chosen numbers are documented against the rest of the application's
      jobs, which sit at 0, and leave gaps for a later level
- [ ] A preview that has fallen behind says so, so an empty preview is never
      read as a rule that would not fire
