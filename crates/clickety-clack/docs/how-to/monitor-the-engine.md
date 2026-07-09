# How to monitor the engine

clickety-clack watches your data, so something has to watch clickety-clack. The engine
exports its own operational metrics over OTLP, alongside the engine traces, covering
every stage of the pipeline: scheduler claim, queue, evaluation, outbox relay, and
delivery.

## Enable the export

Set both engine telemetry variables (see the
[configuration reference](../reference/configuration.md#engine-telemetry-and-metrics-optional)):

```sh
CC_ENGINE_OTLP_ENDPOINT=http://collector:4317
CC_ENGINE_INGEST_API_KEY=<ingest key>
```

When either is unset the process runs exactly as before: every instrument is a no-op
handle and no exporter is created. Metrics ship over OTLP/gRPC on a 60 second interval,
with `service.name` set to `clickety-clack-<role>`.

## Instruments

All instruments live under the `cc.` prefix. Attributes are deliberately
low-cardinality: `tenant` is the only unbounded-ish attribute, and rule ids are never
recorded.

| Instrument             | Type      | Unit | Attributes | Meaning |
| ---------------------- | --------- | ---- | ---------- | ------- |
| `cc.eval.duration`     | histogram | s    | `stage=batch`; or `stage=query`, `outcome` (`success`/`error`), `tenant` | Evaluator latency. `batch` is one whole consume batch (claim, query, evaluate, persist, publish). `query` is one coalesced ClickHouse round-trip (HTTP, body, parse). |
| `cc.eval.errors`       | counter   | `{error}` | `kind` (`query`/`rule_eval`/`consume`), `tenant` (absent for `consume`) | Evaluation failures. `query`: the ClickHouse query failed (this also feeds rule health). `rule_eval`: the query succeeded but evaluating one rule errored. `consume`: the queue consume call failed. |
| `cc.queue.consume.lag` | histogram | s    | *(none)*   | Age of each consumed eval job: consume time minus enqueue time, taken from the Redis stream entry id. Sustained growth means the evaluators are not keeping up with the scheduler. |
| `cc.queue.batch.size`  | histogram | `{job}` | *(none)* | Jobs per non-empty consume call. Pinned at the consume cap (16) is another back-pressure signal. |
| `cc.notify.deliveries` | counter   | `{delivery}` | `channel`, `outcome` (`sent`/`failed`/`no_notifier`), `tenant` | Notification delivery attempt chains, recorded after retries resolve. `failed` and `no_notifier` deliveries are dead-lettered. |
| `cc.scheduler.drift`   | histogram | s    | `tenant`   | Per claimed rule: claim time minus the rule's `next_eval` due time. Steady sub-second drift is the scheduler tick; growth means claim batches or the rule set have outgrown the tick. |
| `cc.outbox.relayed`    | counter   | `{event}` | *(none)* | Outbox rows re-published by the maintenance relay, meaning events whose first publish did not complete. A steady non-zero rate points at an unhealthy event bus or crash-looping evaluators. |

## What to alert on

- `cc.eval.errors` rate by `kind`: `query` errors degrade rules (see
  [observe degraded rules](observe-degraded-rules.md)); `consume` errors mean the
  evaluator cannot reach Redis at all.
- `cc.queue.consume.lag` p99 against each rule's interval: lag beyond the shortest
  interval means evaluations are arriving late.
- `cc.notify.deliveries{outcome="failed"}`: delivery is the engine's last hop; failures
  here are alerts your on-call never saw.
- `cc.scheduler.drift` p99: drift compounds with the claim-time `next_eval` advance, so
  a persistent backlog shifts every rule's cadence.

Where the numbers land is deployment-specific; the instruments themselves are the
stable contract.
