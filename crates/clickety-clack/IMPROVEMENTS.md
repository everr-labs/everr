# Improvements

A technical assessment of clickety-clack against established alerting engines, and
concrete design sketches for the highest-leverage improvements. This is a planning
document: it states where the system stands honestly and what closing the gaps would
mean in code, with file references into the current tree.

File references use `crate/path:line` against the state of the `perf/hot-path-pass`
branch and may drift; treat them as pointers, not coordinates.

---

## 1. Where clickety-clack stands

Strip the naming and clickety-clack is **"Grafana Alerting's evaluation model + Alertmanager's
dispatch pipeline, specialized to ClickHouse, headless, and multi-tenant-first, with a more
rigorous durability story."** It is a **polling / query-based** evaluator: a scheduler enqueues
due rules, an evaluator runs each rule's raw SQL against ClickHouse on an interval, steps a
per-instance state machine, and an Alertmanager-class dispatcher does routing → grouping → dedup
→ silence → inhibition → delivery. Postgres is the durable system of record; Redis Streams are
the hot path.

The correct comparison set is **Grafana Alerting, vmalert, and Elastalert/Watcher**, not
Prometheus + Alertmanager directly, because clickety-clack is *query-on-a-schedule against a
columnar store*, not *streaming rules over a TSDB*.

### Genuine strengths

- **Durability/correctness engineering above the bar of most alerting systems, including
  Alertmanager.** Transactional outbox (atomic instance-write + event-write), an idempotency
  ledger keyed on `(rule, eval_ts)`, delivery dedup in Postgres, and a reconciliation sweep for
  stuck-firing alerts. Coherent at-least-once-everywhere-plus-idempotent-consumers design,
  proptest-enforced. Alertmanager's nflog/dedup and gossip HA are eventually-consistent and can
  drop or double on restart; clickety-clack's "never silently lose or duplicate an alert" story
  is cleaner. This is the standout.
- **SQL-against-ClickHouse is real expressive power.** Joins, window functions, arbitrary
  aggregations, multi-column group keys: things PromQL cannot express.
- **Rule-health as a separate axis with freeze semantics.** When a query errors, instances are
  *frozen* and the absence path is suppressed, so a broken query can't drain firing alerts to a
  false "resolved," and reconciliation won't reap them either. A genuinely well-reasoned
  footgun-removal that even Prometheus handles clumsily.
- **Multi-tenancy from the ground up**, not bolted on (contrast Cortex/Mimir/Thanos retrofitting
  it onto Prometheus).
- **Clean horizontal scaling.** Independent role scaling + leaderless scheduler sharding via
  rendezvous hashing (no leader election, no split-brain).
- **Documentation quality** is exceptional for the maturity level: Diátaxis structure, design
  specs, and explanation docs that state trade-offs honestly.

### Honest gaps versus established engines

- **Polling, not streaming → latency floor and load that scales with rules.** Minimum alert
  latency ≈ eval interval + `group_wait` (default 10s). Worse, it re-runs the **full SQL every
  interval for every rule**; the only optimization today is intra-batch identical-query
  coalescing (`QuerySig`). At scale the evaluator *is* a load generator against ClickHouse, and
  nothing caps that per-tenant. **This is the biggest architectural ceiling: addressed in §4.**
- **No metrics endpoint.** There are `/healthz` and `/readyz` probes and `tracing` logs, but no
  rate/latency/queue-lag/eval-error *counters*. You monitor the engine by scraping its own
  datastores. For an alerting system, weak self-observability is a real operational gap.
- **Silencing is weaker than Alertmanager's, semantically.** Filtering is **at-ingest only**, so
  a silence created during the group window doesn't suppress already-buffered alerts.
  **Addressed in §2.**
- **Three stateful dependencies (Postgres + Redis + ClickHouse).** Operationally heavy versus
  Prometheus+Alertmanager (a couple of single binaries) or Grafana Alerting (one DB).
- **Narrow integrations.** One data source (ClickHouse). Three notification channels
  (Slack/email/webhook) with **fixed per-channel rendering**: no template
  customization, no Opsgenie/Teams/SNS/etc.
- **No higher-order primitives.** No recording rules, SLO burn-rate primitives, or anomaly
  detection. SQL gives you the rope to hand-roll them, but they're not first-class.
- **No UI.** Headless, API-only: operators overwhelmingly want a UI for silences and a
  "what's firing now" view.
- **Maturity.** 0.1.0, single-author, un-battle-tested. Guarantees are asserted and
  proptest-checked, not chaos-tested at scale.

### Priority order for closing the gap

1. A real metrics endpoint (rates, latencies, queue lag, eval errors).
2. **Per-tenant query-load governance** owned by the engine: the real scaling wall (§4).
3. **Notify-time silencing** (§2).
4. **Batched instance writes**: the deferred throughput lever (§3).
5. Receiver templating + more channels.

The current hot-path perf branch is good hygiene but does not address the system-level ceiling,
which is I/O-bound (ClickHouse queries + Postgres state writes), not CPU-bound, as the
load-harness design itself acknowledges.

---

## 2. Notify-time silencing

### What happens today

Silencing and inhibition are evaluated exactly once, **at ingest**, in `process_event`
(`crates/dispatcher/src/lib.rs:122-129`): *before* the event is buffered into its Redis group
(`add_to_group`, `lib.rs:178`). A separate flusher (`flush_group`, `lib.rs:278`) pulls the
buffered events back out up to `group_wait_secs`/`group_interval_secs` later (default 10s, up to
300s) and delivers them. `flush_group` does **no** silence/inhibition check: it goes straight
from `take_group` to dedup to `deliver_one`.

**Consequence:** a silence created during that 10s to 300s window does not suppress alerts already
sitting in the group. You cannot reliably silence an in-flight alert storm: exactly when
operators reach for silences.

### The change

Re-run the filter at flush. Inside `flush_group`, after `take_group` returns `(meta, events)`:

1. Load the tenant snapshot: `meta.tenant` is available (`lib.rs:301`), so `cache.snapshot(tenant)`
   yields `silences`, `inhibitions`, and `firing`. The flusher would need the `FilterCache`
   passed in (`run_group_flusher` currently takes `store, bus, notifiers, groups, cipher`: no
   cache).
2. For each event in the batch, re-derive match labels (`routing::match_labels(ev)`: the group
   stores full `Event`s, so labels are present) and drop any now-silenced/inhibited event.
3. Deliver the surviving subset; if the batch becomes empty, skip like the existing
   `events.is_empty()` guard (`lib.rs:294`).

### Correctness subtleties

- **Dedup-key coupling.** The dedup key is computed over the *active event set*
  (`group_dedup_key(gid, channel, target, &notif.events)`, `lib.rs:319`). Filter events
  *before* computing the key so the key reflects what actually goes out; a later re-flush under a
  different silence state then correctly produces a new key rather than deduping against the old.
- **This narrows the window, doesn't fully close it.** Filtering still happens at flush, gated by
  the ~2s snapshot TTL, but since flush *is* the delivery moment here, that is effectively
  notify-time. Residual gap shrinks from the whole group window to ~2s.
- **Resolved events.** Decide explicitly whether resolves bypass silence (you usually want the
  "all clear" even for a silenced alert). The current at-ingest path does not make this
  distinction either.

### Cost

One extra cached snapshot read per *flush* (not per event), already memoized at a 2s TTL.
Negligible. **This is the cheapest of the dispatch/evaluator changes and has the clearest
correctness payoff.**

---

## 3. Batched instance writes (the deferred throughput lever)

### What happens today

`evaluate_rule_against_rows` (`crates/evaluator/src/lib.rs:239`) loops over every present row and
every known-absent instance, and for *each one* calls `publish_transition` (`lib.rs:273, 292`).
Per instance, that is:

- no-event case: one `upsert_instance` (one Postgres round-trip), or
- event case: one `upsert_instance_with_outbox` (a transaction: instance UPSERT + outbox
  INSERT), then an inline `events.publish`, then a `delete_outbox` (`lib.rs:302-327`).

So a rule matching **N instances does N sequential round-trips** (plus the `load_instances` read
at `lib.rs:252`). A rule that flaps 500 series performs ~500 transactions per evaluation,
serially. **This is the evaluator's throughput wall** (per-instance I/O latency × N), which is why
the performance-pass design explicitly deferred it (`docs/superpowers/specs/2026-06-15-performance-pass-design.md`,
§Scope).

### The change

Collect all transitions for the rule in memory, then commit them as a bounded number of
statements:

1. Run `evaluate(...)` for every instance in memory (already pure, no I/O), accumulating
   `next_states: Vec<InstanceState>` and `events: Vec<(Event, outbox_id)>`.
2. **One transaction:** bulk-UPSERT all `next_states` (multi-row `INSERT ... ON CONFLICT`, or an
   `UNNEST`-driven upsert) **and** bulk-INSERT all outbox rows. This preserves exactly-once:
   state and outbox still commit atomically, just at batch granularity.
3. After commit, publish the events (ideally one pipelined `XADD` batch to Redis), then
   bulk-delete the committed outbox rows on success. Anything not deleted is recovered by the
   existing maintenance relay, exactly as today.

### Why it was deferred (the real reason)

The atomic boundary today is *one instance + one event* in `upsert_instance_with_outbox`.
Batching widens that boundary to *one rule's whole transition set*. The exactly-once invariant is
preserved in principle (atomic-per-batch is still atomic), but the failure modes shift: a partial
publish now leaves a *batch* of outbox rows for the relay instead of one, so the publish step must
remain idempotent per-event (it is, via the downstream dedup ledger), making a relay re-publish of
part of a batch safe. Contained, but it touches the system's most safety-critical seam: it
deserves its own spec and proptest pass rather than riding along in a hot-path-allocation PR.

### Payoff

N round-trips → ~3 statements per rule-evaluation. For high-cardinality rules this is the single
biggest evaluator throughput improvement available, and unlike the allocation work it attacks the
actual bottleneck.

---

## 4. Reducing ClickHouse load (the "polling is a load generator" problem)

The structural fact: the scheduler enqueues every rule when `next_eval <= now`
(`claim_due_rules_sharded`, `crates/stores/src/pg.rs:255`), and the evaluator runs each rule's
**full SQL over current state, every interval** (`query_rows`, `crates/clickhouse/src/lib.rs:53`).
Load scales as Σ(1/interval) across all rules, and each query is a from-scratch scan. The only
optimization in place is `QuerySig` coalescing (`crates/evaluator/src/lib.rs:151-159`), which
merges only **byte-identical** SQL under the same auth identity.

Five approaches follow, cheapest-first within each tier. Items 4.4 and 4.5 reduce *how often* you
scan; items 4.1 to 4.3 reduce *how much each scan costs*.

### 4.1 Materialized views, projections, and cousins

**Core idea.** Flip from **scan-on-read** to **maintain-on-write**. A ClickHouse MV is an insert
trigger, not a cache. When a block lands in the source table, the MV's SELECT runs over *just
that block* and writes partial aggregates into a small target table. The rule then reads the
rollup (kilobytes) instead of scanning the raw table.

```sql
-- target: tiny, keyed by (service, minute)
CREATE TABLE spans_1m (
    service LowCardinality(String),
    minute  DateTime,
    total   AggregateFunction(count),
    errors  AggregateFunction(countIf, UInt8)
) ENGINE = AggregatingMergeTree ORDER BY (service, minute);

CREATE MATERIALIZED VIEW spans_1m_mv TO spans_1m AS
SELECT service, toStartOfMinute(ts) AS minute,
       countState() AS total, countIfState(error) AS errors
FROM spans GROUP BY service, minute;
```

The rule SQL becomes a cheap read over the rollup:

```sql
SELECT service, countIfMerge(errors) / countMerge(total) AS er
FROM spans_1m WHERE minute > now() - INTERVAL 5 MINUTE
GROUP BY service HAVING er > 0.05
```

**Cost moves from O(rules × scan) to O(ingest × 1), amortized.** A hundred rules over `spans` no
longer mean a hundred scans.

**The critical decision: who owns the MV?** This intersects clickety-clack's stated invariant:
`docs/explanation/architecture.md:70`: ClickHouse is read-only, "it reads it, never writes it or
manages its schema."

- **Option A: operator-owned (ship this).** The engine stays read-only. The MV/target table is
  part of the operator's ClickHouse schema; rule SQL just points at the rollup. **Zero engine
  code**: a reference-architecture + how-to deliverable. Optionally, the engine ships a DDL
  *generator*: given a `RuleSpec`, emit suggested MV/target DDL as text for the operator to apply
  (read-only; just prints SQL). Preserves the read-only posture, per-tenant auth, and
  multi-tenancy untouched.
- **Option B: engine-managed (avoid).** The engine creates/drops MVs per rule. Breaks the
  read-only invariant, needs DDL grants (conflicts with the locked-down per-tenant CH users in
  `docs/how-to/harden-clickhouse-access.md`), and drags in MV lifecycle: versioning on SQL change,
  historical backfill, GC on rule delete, all per-tenant. High complexity, high blast radius.

**Two lower-friction cousins:**

- **Projections: the sweet spot.** A projection is a pre-aggregation *attached to the raw table*
  that ClickHouse maintains automatically and the query planner picks **transparently**: *no
  rule-SQL rewrite at all*. `ALTER TABLE spans ADD PROJECTION p_svc_1m (SELECT service,
  toStartOfMinute(ts), count(), countIf(error) GROUP BY ...)` and existing matching rule queries
  get the speedup for free. Lowest friction (no target table, no query change), still
  operator-owned DDL. For clickety-clack this is arguably the best fit because rules stay written
  against the natural table and nothing in the engine changes.
- **Refreshable MVs** (recent ClickHouse) re-run their SELECT on a schedule rather than
  per-insert: literally moving clickety-clack's polling into ClickHouse. Tempting, but it
  relocates scan cost rather than eliminating it and surrenders the engine's scheduling control.
  Prefer insert-triggered MVs or projections.

**Interaction with presence/absence.** The absence path (`crates/evaluator/src/lib.rs:279`) lives
in *Postgres* (`load_instances`), not ClickHouse: the CH query only produces the *present* set.
So MVs/projections make producing the present set cheap and do not perturb absence detection. The
only new latency is rollup granularity (the 1-minute bucket adds up-to-a-minute staleness), which
is fine for threshold alerting and is tunable via bucket size.

**Bottom line:** ship operator-owned **projections/MVs + a how-to doc + an optional
DDL-suggestion generator**. Highest-leverage load reduction available, near-zero engine cost,
precisely because the engine does *not* own ClickHouse DDL.

### 4.2 Shared-scan / multi-rule fusion

**Concept.** `QuerySig` coalesces *byte-identical* SQL into one round-trip. Fusion extends this to
*different* rules over the *same source*: rewrite N rules' predicates into one query that computes
all N conditions in a single scan, then split the result columns back to each rule in-process.

**What changes.** A new pass between groups (3) and "run each query"
(`crates/evaluator/src/lib.rs:162`):
- A **fusion key** coarser than `QuerySig`: derived from the parsed FROM/JOIN/WHERE-time-window
  via `sqlguard` (which already holds the `sqlparser` AST, `crates/sqlguard/src/lib.rs:18`). Rules
  sharing source + grain + label set + time window are fusion candidates.
- A **rewriter** that turns each rule's `HAVING`/threshold into a column projected once
  (e.g. select `er` once; apply rule A's `er > 0.05` and rule B's `er > 0.10` afterward, in Rust,
  over the shared rows).
- A **demux** step mapping the shared result's rows back to each member rule (each keeps its own
  `label_columns`/`value_column`), then feeding each into the existing `evaluate_rule_against_rows`.

**Correctness gotchas.**
- Only fuse when you can *prove* the scan is shared and the rewrite is semantics-preserving:
  different `GROUP BY` grains, time windows, or `JOIN`s make rules un-fusable; fall back to
  per-rule. Start conservative (same table, same grain, threshold-only differences).
- A fusion-key collision that wrongly merges two queries fans the wrong rows to the wrong rule:
  the same risk that led the design to reject a `u64`-hash `QuerySig` shortcut
  (`docs/superpowers/specs/2026-06-15-performance-pass-design.md`, §2c). Must be a structural
  match, not a hash.
- Per-tenant auth still partitions: fuse only within one `AuthIdentity`, as `QuerySig` does today.

**Cost-benefit.** Highest *structural* win (N scans → 1) but the most engine code and the most
ways to be subtly wrong. Needs its own spec and a proptest harness proving fused == unfused
row-for-row. Build it *after* the operator MV path, which attacks the same cost from the cheaper
side.

### 4.3 Incremental / windowed evaluation

**Concept.** Rewrite "all currently-bad rows" into "bad rows since the last watermark":
`WHERE ts > {last_eval}` against an append-only, ts-ordered table, so each eval reads a delta
rather than a full window.

**What changes.** The scheduler already tracks per-rule timing (`next_eval`); add a
`last_eval_watermark` and thread it into `query_rows` as a bind parameter. Small change at the
seam.

**The blocking gotcha.** This **breaks absence detection.** The state machine resolves an alert by
noticing a row that *used* to be present is now *gone* (`crates/evaluator/src/lib.rs:279`). A pure
delta query only ever sees *new* rows, so alerts would fire and never resolve. You need a
**hybrid**: delta scans drive the *firing* edge cheaply, while resolution comes from either
periodic full scans at a slower cadence, or leaning on the existing reconciliation sweep
(`crates/evaluator/src/maintenance.rs`, the `max(4×interval, 60s)` auto-resolve) as the only
resolution path. That is a real change to the resolve story and its latency characteristics.
Workable but invasive: lower priority than 4.1 and 4.4.

### 4.4 Adaptive / backoff scheduling

**Concept.** Reduce Σ(1/interval), the quantity that actually generates load, by spacing out
evaluations of stable rules and snapping back to full cadence on any change. A rule flat for an
hour does not need a 30s cadence; one actively flapping does.

**What changes: clean and entirely scheduler-side.** Today `next_eval` advances rigidly:
`SET next_eval = $1 + make_interval(secs => interval_secs)` (`crates/stores/src/pg.rs:226`). Make
the increment adaptive:
- Track a per-rule `stable_evals` counter (a column on `rules`, or derived from existing
  `last_eval`/instance state).
- The evaluator increments it after an evaluation that produced *no transition*; any transition
  resets it to 0.
- The scheduler's advance multiplies the base interval by a capped backoff of `stable_evals`
  (e.g. `interval × min(2^stable, 8)`), so a quiet rule drifts 30s → 60s → 120s → … → 4min, and
  the first change yanks it back to 30s.

**Gotchas.** Backoff widens worst-case detection latency for a rule that was quiet then breaks:
cap the multiplier and allow per-rule opt-out (a `max_interval` in `RuleSpec`). The
reset-on-change signal flows from evaluator back to the rule row; fold that small write into the
health-gate write path the perf pass §2a already touches.

**Cost-benefit.** Best effort-to-value ratio of the five. No query change, no ClickHouse work,
pure Postgres/scheduler logic, directly cutting total scan volume. Lower ceiling than fusion/MV
but cheap and safe.

### 4.5 Jitter / anti-thundering-herd

**Concept.** Many rules share round intervals (30s, 60s), so `next_eval <= now` flips true for all
of them on the same wall-clock tick and they stampede ClickHouse in a burst. Total work is
unchanged; the *profile* is spiky, which hurts ClickHouse tail latency and can trip the
`max_execution_time=10` cap (`crates/sqlguard/src/lib.rs:31`) under contention.

**What changes.** Effectively one line. When a rule is first armed (or on create), add a
deterministic per-rule phase offset `hash(rule_id) % interval` to its initial `next_eval`. The
advance in `pg.rs:226` preserves the offset (it always adds a full interval), so the rules stay
staggered forever. Spreads a synchronized burst into a flat stream.

**Gotchas.** Essentially none: phase, not frequency, so total load and per-rule cadence are
unchanged. Make it a stable function of `rule_id` so it survives restarts and is identical across
scheduler replicas (the codebase already leans on deterministic hashing for sharding).

---

## 5. Sequencing

| #   | Improvement                         | Effort  | Ceiling   | Touches                         | Risk                    |
| --- | ----------------------------------- | ------- | --------- | ------------------------------- | ----------------------- |
| 4.5 | Jitter                              | trivial | low       | scheduler/store                 | ~none                   |
| 4.4 | Adaptive scheduling                 | low     | medium    | scheduler + 1 write             | low                     |
| 4.1 | MV/projections (operator-owned)     | low     | very high | docs, optional DDL generator    | ~none to engine         |
| 2   | Notify-time silencing               | low     | n/a       | dispatcher flusher + cache      | low                     |
| 3   | Batched instance writes             | medium  | high      | evaluator + stores              | medium (exactly-once)   |
| 4.2 | Shared-scan fusion                  | high    | very high | evaluator + sqlguard            | high (wrong-row fan-out)|
| 4.3 | Incremental/windowed                | high    | high      | query seam + resolve semantics  | high (breaks absence)   |

**Ship first:** 4.5 + 4.4 + 4.1 + §2. They are cheap and safe, and 4.1 (projections especially) is
the biggest single lever precisely because it keeps the engine read-only and lets ClickHouse do
what it is good at. **Reserve** 4.2 and 4.3 for dedicated specs with adversarial correctness
testing: they are where the engine could outgovern ClickHouse's own quotas, but also where you
can silently fan the wrong rows to the wrong rule or stop resolving alerts.

**Throughline:** clickety-clack currently delegates *all* load governance to ClickHouse
(`sqlguard` row/time/memory caps + per-tenant quotas). Items 4.4 and 4.5 give the *engine* cheap
control over how much it asks for; item 4.1 makes each ask cheap without engine code; items 4.2
and 4.3 make the engine genuinely smart about it, at real complexity cost.
