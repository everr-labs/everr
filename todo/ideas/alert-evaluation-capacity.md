# Alert evaluation capacity

Deterministic evaluation phases smooth normal alert and SLO traffic. They do
not provide a hard capacity boundary when multiple application replicas share
the same Graphile Worker database or ClickHouse service.

## Global evaluation concurrency

Worker concurrency is configured per application process, so aggregate query
concurrency grows with the number of replicas. Introduce a configurable number
of evaluation lanes shared by every worker that targets the same ClickHouse
service. Keep notification and maintenance jobs outside those lanes so slow
queries cannot block delivery work.

The lane assignment should account for:

- The ClickHouse service or pool serving the organization.
- Fairness between organizations sharing that service.
- Separate capacity for dedicated customer services.
- Queue depth, oldest-job age, query duration, and evaluation lateness metrics.

## SLO query fan-out

One SLO evaluation can query several due burn-rate windows concurrently. Add a
small per-evaluation concurrency limit, likely one or two queries, after the
expected ClickHouse capacity and evaluation latency are measured.

## Initial evaluation latency

The first evaluation currently uses the same deterministic phase as recurring
evaluations, so it can wait for up to one full interval. If long rule intervals
make that confusing, introduce a separately bounded initial delay without
changing the recurring phase.

## Rule health history

Rule lists and detail pages expose current evaluator health. If operators need
an audit trail of evaluator outages and recoveries, emit explicit rule-health
events when health changes rather than adding every failed attempt to history.
