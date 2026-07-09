# How clickety-clack's performance compares

**Read this first (the caveat that governs everything below):** a clean
"X rules/sec vs Y rules/sec" leaderboard against other alerting systems **cannot be built
honestly.** The only peers that publish throughput numbers (Grafana Mimir, Cortex) bundle the
expensive external work — executing the query against the time-series database, and the real
notification send (SMTP/webhook/PagerDuty latency) — *into* their figures. clickety-clack's
load harness deliberately **stubs ClickHouse and the webhook endpoint** to isolate the
engine's own orchestration cost. So the numbers measure different things. This note positions
clickety-clack architecturally and states only what the evidence supports.

clickety-clack's measured per-node numbers (single test Postgres + Redis container, ClickHouse
stubbed, instant webhook; see `docs/load-testing.md`):

- Evaluator: ~501 rules/sec, ~10,000 instance-evaluations/sec → ~15,000 rules held per node at
  a 30 s evaluation interval (`rules/sec × interval`).
- Dispatcher ingest: peak ~12,300 events/sec (~4 workers).
- Notification flush: ~3,855 deliveries/sec (instant webhook — orchestration ceiling, not a
  real send rate).
- Scales out across sharded replicas.

## Who the real peers are

Not Prometheus + Alertmanager — those are single-process, in-memory, single-tenant, and
TSDB-local, so they pay none of the durability / multi-tenancy / external-store costs
clickety-clack does. The genuine peers:

- **Architecture (scale-out, multi-tenant, durable):** Grafana **Mimir** (Ruler +
  multi-tenant Alertmanager) and **Cortex**. clickety-clack is essentially "a Mimir Ruler +
  Alertmanager, evaluating against ClickHouse instead of a PromQL TSDB."
- **Data backend (alerting *on ClickHouse*):** SigNoz, Uptrace, Coroot, HyperDX.
- **Durable DB-backed alerting:** Grafana unified alerting (Postgres-backed), Bosun.

## Published figures (sourced)

| System | Published figure | Source |
|---|---|---|
| Mimir Ruler | "rules evaluation is computationally equal to queries execution" → querier sizing: **1 core / 10 queries/sec** (≈10 rule-evals/sec/core), incl. query execution | [mimir capacity-planning](https://grafana.com/docs/mimir/latest/manage/run-production-environment/planning-capacity/) |
| Mimir Alertmanager | **1 CPU core / 100 firing notifications/sec**; 1 GB / 5,000 firing alerts (real sends) | same |
| Cortex Alertmanager (2020 proposal, pre-sharding) | **~80 alerts received/sec, ~40 notifications/sec per replica** (~700 tenants); ~3.7 MB + 0.001 core/tenant | [cortex scalable-alertmanager](https://cortexmetrics.io/docs/proposals/scalable-alertmanager/) |
| Grafana unified alerting | **No numeric limit published** — config "affects the maximum number… can support", no maximum stated | [grafana perf-limitations](https://grafana.com/docs/grafana/latest/alerting/set-up/performance-limitations/) |
| Prometheus Alertmanager (standalone) | No published throughput figure | — |
| SigNoz / Uptrace / Coroot / HyperDX | No published alert-rule scale/throughput figures | — |
| vmalert | No published rules-per-node throughput figure (config knobs only) | [vmalert docs](https://docs.victoriametrics.com/victoriametrics/vmalert/) |

(Figures gathered via a multi-source, adversarially-verified search; a raised "GEM 1M
series/tenant default" claim was **refuted** during verification and is excluded.)

## What the two real data points actually let us say

**Rule evaluation.** Mimir's ruler does **~10 rule-evals/sec/core** — but that *includes
executing the PromQL query against the TSDB*. clickety-clack's ~501 rules/sec (~60/sec/core on
the test box) was measured with **ClickHouse stubbed**, so it measures *orchestration only*;
the query cost lives in ClickHouse and is counted separately. clickety-clack is therefore
**not** "6× faster than Mimir's ruler" — it moved the expensive part (the query) out of the
number. Fair statement: clickety-clack's per-rule bookkeeping overhead is low; the real
evaluation ceiling for both systems is the data-store query.

**Notification dispatch.** Cortex measured **~40 notifications/sec/replica** and Mimir budgets
**100/sec/core** — both *real sends* (network latency included). clickety-clack's ~3,855
deliveries/sec used an **instant webhook stub**, so it's the orchestration ceiling
(claim → dedup → mark-sent), not a real send rate. Real sends are gated by the notifier
endpoints — for clickety-clack exactly as for Mimir/Cortex.

## Where clickety-clack realistically sits

- **Architecture:** squarely in the Mimir/Cortex family (multi-tenant, durable, horizontally
  sharded rule evaluation + Alertmanager-style dispatch) — but ClickHouse-backed. That precise
  niche (durable multi-tenant alerting *on ClickHouse*) has **no peer that publishes
  throughput numbers**, which is why an honest head-to-head table can't be assembled.
- **Throughput-per-node:** the orchestration layer is demonstrably not the bottleneck —
  hundreds of rules/sec and thousands of dispatch ops/sec per node, scaling out across shards.
  The real-world ceiling, for it and every peer, is the **data-store query** (ClickHouse) and
  the **notification endpoints** — neither of which the published peer figures isolate the way
  clickety-clack's harness does.

**Bottom line:** defensible claim = architectural parity with Mimir/Cortex plus a ClickHouse
backend, with an orchestration layer fast enough that — like its peers — it won't be the
limiting factor. Anything stronger than that would be comparing a stubbed number against a
query-and-send-inclusive one.
