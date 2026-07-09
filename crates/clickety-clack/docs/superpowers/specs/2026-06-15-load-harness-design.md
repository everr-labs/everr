# End-to-End Load/Throughput Harness — Design

**Status:** Approved (design phase)
**Date:** 2026-06-15
**Goal:** Measure the throughput clickety-clack can actually sustain — rules/sec and
evaluations/sec for the evaluator, and events/sec + deliveries/sec for the dispatcher —
through the real production components over real Postgres + Redis.

---

## 1. Motivation

The existing benches (`crates/{engine,clickhouse,dispatcher}/benches/`) measure pure-CPU
hot paths and report single-core ceilings (e.g. ~1.13M evaluations/sec, ~1.16M routing
decisions/sec). Those ceilings tell us the optimized code imposes essentially no limit —
the real constraint is the I/O the micro-benches deliberately exclude (Postgres state
writes, Redis queue/stream round-trips, the ClickHouse query). This harness measures the
**system** number: sustained throughput with that I/O in the loop.

## 2. Scope decisions (settled during brainstorming)

- **ClickHouse backend: both.** A fast in-process Axum **stub** is the headline (isolates
  clickety-clack's own orchestration cost from CH server time, which the operator controls
  separately); a **real ClickHouse testcontainer** is available behind a flag as a
  cross-check. Both go through the same `ChClient` + `parse_rows` path — only the server
  differs.
- **Form: ignored integration tests with a printed report.** Not criterion (built for fast
  pure functions, not sustained multi-service async load with one-time container setup).
- **Pipeline: both stages, measured separately**, so the slower stage never masks the
  faster one. Within the dispatcher stage, ingest and flush are **also** separated (see §5),
  because grouping makes "events in" and "deliveries out" different units with different
  bottlenecks.

## 3. Architecture

Workspace-level integration tests (the repo already keeps e2e tests at `tests/`):

- `tests/load_evaluator.rs` — `load_evaluator_throughput` (`#[ignore]`)
- `tests/load_dispatcher.rs` — `load_dispatcher_throughput` (`#[ignore]`)
- `tests/common/mod.rs` — shared support: container bring-up, the CH backend selector, a
  `NoopBus`, env-driven config, and the report printer.

Run on demand, never in normal CI:

```
cargo test --release --test load_evaluator -- --ignored --nocapture
cargo test --release --test load_dispatcher -- --ignored --nocapture
```

**Faithfulness principle:** every component in the *measured* path is the real production
type — `PgStore`, `RedisQueue`, `RedisEventBus`, `ChClient`, the Redis-backed `GroupStore`,
`FilterCache`, `process_batch_inner`, `process_event`, `flush_group`. The harness owns only
the **driver loop** (so it can detect completion and time a fixed workload). Nothing in the
measured path is reimplemented. The forever-loops `run_evaluator`/`run_dispatcher`/
`run_group_flusher` are *not* used directly because polling them for "queue drained" is racy
and can't cleanly time a bounded workload; the bounded driver calls the same inner functions.

Each test follows: bring up infra → seed workload → **warm-up pass (discarded)** → **measured
pass under wall-clock** → assert all work completed (so we never time a broken fast-fail
path) → print report.

## 4. Evaluator stage — rules/sec + evaluations/sec

**Seed:** `PgStore::create_rule` × `CC_LOAD_RULES`, each with a `RuleSpec` carrying a value
column and a few label columns. **Each rule gets distinct SQL** (e.g. the rule index baked
into the query text) so the evaluator's `QuerySig` coalescing does *not* collapse the batch
into a single CH round-trip — that would measure a best-case artifact, not steady state.
A `CC_LOAD_COALESCE=1` knob can force identical SQL to additionally measure the
full-coalescing best case.

**ClickHouse:** `ChClient` pointed at the selected backend.
- *Stub:* an Axum server returning a synthetic JSONEachRow body of
  `CC_LOAD_INSTANCES_PER_RULE` rows, instantly.
- *Real:* a ClickHouse testcontainer with one seeded table; each rule's SQL `SELECT`s from
  it returning `CC_LOAD_INSTANCES_PER_RULE` rows.

**Drive:** enqueue one `EvalJob` per rule into `RedisQueue`; spawn `CC_LOAD_EVAL_WORKERS`
tasks, each running the genuine steady-state loop:

```text
let mut health = HashMap::new();            // persistent per-worker, as run_evaluator does
loop {
    if processed >= N { break }
    let deliveries = queue.consume(consumer, 16, block_ms).await?;
    let n = deliveries.len();
    let acks = process_batch_inner(&store, ch, &noop_bus, degrade_after, deliveries, &mut health).await;
    for id in acks { queue.ack(&id).await?; }
    processed.fetch_add(n);                  // shared AtomicUsize; workers stop at N
}
```

**Bus:** `NoopBus` — deliberately isolating the evaluator. Event *publish* cost is the
dispatcher stage's input and is measured there. At steady state this is nearly free anyway:
no status transition ⇒ no event (the `None` branch of `publish_transition` just upserts),
and the warm health map skips `record_rule_success`. The measured path is therefore the real
PG-dominated hot loop: `try_claim_eval` + `get_rule` + the coalesced CH query (one per
`QuerySig`) + `load_instances` + `upsert_instance`.

**Report:**
- `rules/sec` = N / wall
- `evaluations/sec` = N × `CC_LOAD_INSTANCES_PER_RULE` / wall

## 5. Dispatcher stage — events/sec and deliveries/sec (two isolated numbers)

Grouping makes ingest and flush different units (E events collapse via `group_by` into far
fewer deliveries) with different bottlenecks, so each is measured on its own.

**Shared seed:** one tenant with routes + receivers + a few active (non-matching) silences +
an inhibition rule + a small firing set, loaded through the real `FilterCache` (exercising
the snapshot + receiver-decrypt path). Cipher: `EnvKeyring` (as in `cache_it.rs`). Routes use
`group_wait_secs = 0` so buffered groups are immediately due for the flush stage (`claim_due`
only returns groups whose timer has elapsed).

### 5a. Ingest → route → group-buffer (`events/sec`)

- **Drive:** `bus.publish` × `CC_LOAD_EVENTS` into `RedisEventBus`; spawn
  `CC_LOAD_DISPATCH_WORKERS` tasks running the real consume loop → `process_event` →
  buffer into the Redis-backed `GroupStore` (the routed/grouping path — the richer default).
  Workers stop at E.
- **Bottleneck measured:** routing CPU + Redis `add_to_group` writes.
- **Report:** `events/sec` = E / wall.

### 5b. Flush → deliver (`deliveries/sec`)

- **Setup:** after 5a has buffered the events into groups (or a dedicated pre-buffer step),
  run the real flush path: `claim_due` → `flush_group` (`take_group` → decrypt target →
  `try_begin_notification` (PG dedup) → `deliver_one` → notifier → `mark_notification_sent`).
- **Webhook stub returns 200 instantly**, isolating clickety-clack's flush orchestration
  (claim/take/decrypt/PG-dedup/mark) from network time — the same stub philosophy used for
  ClickHouse. The notifier code path (reqwest + retry) is still real; only the endpoint is
  instant.
- **Drive:** spawn `CC_LOAD_DISPATCH_WORKERS` flusher tasks calling `claim_due` +
  `flush_group` until no groups remain.
- **Report:** `deliveries/sec` (= notifications marked sent / wall) and `groups
  flushed/sec`. Because of grouping, this is a different and smaller count than E.

The two numbers are reported separately so neither masks the other.

## 6. Knobs & report

Env-driven, defaulted, echoed in the report:

| Var | Default | Meaning |
|---|---|---|
| `CC_LOAD_RULES` | 2000 | rules seeded / eval jobs per pass |
| `CC_LOAD_INSTANCES_PER_RULE` | 20 | rows returned per query |
| `CC_LOAD_EVAL_WORKERS` | 8 | evaluator worker tasks |
| `CC_LOAD_EVENTS` | 50000 | events for the dispatcher ingest stage |
| `CC_LOAD_DISPATCH_WORKERS` | 8 | dispatcher / flusher worker tasks |
| `CC_LOAD_CH` | `stub` | `stub` or `real` |
| `CC_LOAD_COALESCE` | `0` | `1` forces identical SQL to measure the full-coalescing best case |

**Report format** (stderr, via `--nocapture`): echo the resolved config, the CH backend,
wall-clock per stage, and the derived rates, followed by an explicit caveat line that the
numbers are machine/container-dependent and that the stub backends factor out CH server time
and webhook network time (so they measure clickety-clack's own orchestration ceiling, not a
third party's).

## 7. Error handling & correctness gates

- Each stage asserts the full workload completed (processed == N / E, groups drained) before
  printing — a number from a path that silently fast-failed is worthless.
- The evaluator stage asserts instances were upserted (sanity that real work happened).
- Container/stub setup failures fail the test with a clear message (no silent skips).
- A per-stage timeout guards against a hang producing a misleadingly "infinite" wait.

## 8. Out of scope

- Scheduler throughput (claim_due_rules tick rate) — the harness enqueues jobs directly,
  matching the scheduler's output without timing the scheduler itself.
- Multi-node/sharded failover behavior.
- Latency percentiles (p50/p99). Headline is throughput; percentiles can be a later add if
  wanted, but YAGNI for now.
- Tuning Postgres/Redis/ClickHouse server configs — measured against testcontainer defaults,
  noted in the caveat.

## 9. File structure

| File | Responsibility |
|---|---|
| `tests/common/mod.rs` | infra bring-up (PG+Redis), CH backend selector (stub Axum / real CH), `NoopBus`, `LoadConfig` (env), report printer, seed helpers |
| `tests/load_evaluator.rs` | evaluator stage test (§4) |
| `tests/load_dispatcher.rs` | dispatcher ingest + flush tests (§5) |

`tests/common/mod.rs` keeps each test file focused on its stage; shared setup lives in one
place. If `common` grows unwieldy, split the CH stub and the report printer into their own
submodules during implementation.
