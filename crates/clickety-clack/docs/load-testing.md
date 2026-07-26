# Load / throughput testing

These are `#[ignore]`d integration tests under `tests/` that measure sustained throughput
over real Postgres + Redis (testcontainers). They never run in normal CI; run them on
demand. Docker is required.

## Run

```
cargo test --release --test load_evaluator  -- --ignored --nocapture
cargo test --release --test load_dispatcher -- --ignored --nocapture
```

## Knobs (env vars)

| Var | Default | Meaning |
|---|---|---|
| `CC_LOAD_RULES` | 2000 | rules seeded / eval jobs per pass |
| `CC_LOAD_INSTANCES_PER_RULE` | 20 | rows returned per query |
| `CC_LOAD_EVAL_WORKERS` | 8 | evaluator worker tasks |
| `CC_LOAD_EVENTS` | 50000 | events for the dispatcher stages |
| `CC_LOAD_DISPATCH_WORKERS` | 8 | dispatcher / flusher worker tasks |
| `CC_LOAD_CH` | `stub` | `stub` (instant Axum) or `real` (ClickHouse container) |
| `CC_LOAD_COALESCE` | `0` | `1` forces identical SQL to measure the full-coalescing best case |

## What each number means

- **evaluator** -> `rules/sec`, `evaluations/sec`: the evaluator hot loop + its Postgres/Redis
  I/O (claim, get_rule, coalesced CH query, load_instances, upsert). Measured at **steady
  state**: workers hold a persistent health map warmed by an untimed pass, so the measured
  pass skips the `record_rule_success` round-trip (as the long-running evaluator does) rather
  than paying the cold-start cost once per rule. The measured pass re-evaluates already-firing
  rows, so there are no status transitions: it excludes per-transition event publish + outbox
  cost (which `NoopBus` also isolates) and reflects the no-transition steady state.
- **dispatcher-ingest** -> `events/sec`: consume -> route -> group-buffer into Redis.
- **dispatcher-flush** -> `deliveries/sec`, `groups/sec`: claim_due -> take_group -> decrypt ->
  PG dedup -> mark_sent, with an instant webhook (network time factored out).

The `stub` CH backend and instant webhook isolate clickety-clack's own orchestration cost
from third-party server/network time -- that is the headline. `CC_LOAD_CH=real` is a
cross-check. All numbers are machine/container-dependent (testcontainer defaults).
