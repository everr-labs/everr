# Rule Health & Degraded-State Notifications — Design

> **Status: APPROVED.** Spec B, split out of the per-tenant ClickHouse auth work
> (`2026-06-14-per-tenant-clickhouse-auth-design.md`). Supersedes the pre-spec context
> notes in `2026-06-14-rule-health-degraded-state-NOTES.md` (kept for provenance).

**Goal:** When a rule's evaluation *query* fails repeatedly, surface it as a routable,
silenceable notification through the existing dispatch pipeline — and guarantee a degraded
rule's frozen alert instances are never falsely resolved.

---

## Motivation

When a rule's evaluation query fails — ClickHouse unreachable, a `SELECT` referencing a
dropped column, a timeout (`max_execution_time`), a result-row cap hit (`max_result_rows`
with `result_overflow_mode='throw'`), or a misprovisioned per-tenant CH user — the failure
is recorded silently in `rules.last_error` and never surfaced. A rule can be broken for
hours and on-call never knows. For an alerting system that is a serious blind spot: the
thing whose job is to tell you when something is wrong is itself silently wrong.

This design elevates the existing silent error sink (`store.record_eval_error`) into an
observable, routable, debounced rule-health signal.

### What already exists (verified — do not rebuild)

- **Freeze-on-error is already correct.** `crates/evaluator/src/lib.rs` on a query error
  logs, records the error, and `continue`s — it never runs the absence path, so instances
  stay frozen and a CH outage cannot drain firing alerts to a false `Resolved`. We do not
  build freeze semantics; they hold.
- **A silent per-rule error sink exists:** `rules.last_error` / `last_eval`, written by
  `record_eval_error`. This design elevates it, not replaces it.
- The dispatch pipeline (routing, grouping, dedup, silences, inhibition), the event bus,
  and the outbox/exactly-once delivery all already exist and are **reused**.

---

## 1. Event model — one pipeline, typed discriminator

The entire dispatch pipeline consumes a single `Event` struct and keys off synthetic
`severity`/`status`/`rule` labels. Routing, silences, and grouping are pure label-matching
— they do not know what an alert *means*. Rule-health is "a rule-scoped condition that is
either firing (degraded) or resolved (recovered)" — which **is** an `Event`. We reuse the
struct rather than fork the pipeline.

- Add `EventKind { Alert, RuleHealth }` to `crates/domain/src/event.rs`.
- Add a required `kind: EventKind` field to `Event`. Every existing construction site sets
  `EventKind::Alert`. No back-compat / no `serde(default)` — the system has never been
  deployed.
- **Degraded = `RuleHealth` + `Firing`; Recovered = `RuleHealth` + `Resolved`**, both on a
  stable per-rule `instance_key`, so dedup pairs them exactly like firing→resolved pairs
  today.
- `routing::synthetic_labels` gains a `kind` synthetic label (`"alert"` | `"rule_health"`),
  projected from `ev.kind`, alongside the existing `severity`/`status`/`rule`. Operators
  route and silence health with matchers they already understand:
  `kind="rule_health" → oncall`.
- **Nothing else in the pipeline changes.** Bus, dispatcher consume loop, grouping, dedup,
  silence, inhibition, and the outbox all consume `Event` unchanged.

**Why not a separate `RuleDegraded`/`RuleRecovered` event type:** a second type forks the
generic label-routed pipeline permanently — every future feature (new receiver, new
grouping option, new silence semantic) would pay the cost twice, and silence/grouping
applicability would become hardcoded policy in match arms instead of operator-configurable
matchers. A typed `EventKind` field gives the only real benefit of a separate type
(exhaustive, non-magic-string discrimination) while keeping one pipeline and one set of
delivery guarantees.

## 2. Scope of "failure" (deliberately narrow)

Only the **query-error branch** drives health — the `ch.query_rows(...) => Err(e)` arm in
`process_batch`. Causes: CH unreachable / connection refused / timeout, result-row cap
(`max_result_rows` throw), schema drift (dropped/renamed column or table), per-tenant CH
auth failure, memory/row-scan caps.

The downstream evaluate/store-error branch (`evaluate_rule_against_rows(...) => Err(e)`) is
Postgres/engine infrastructure failure — a different failure domain (the whole engine is
unhealthy, not one rule's query). It does **not** affect rule health; it keeps its current
`record_eval_error` logging behavior unchanged.

A query error fails a whole coalesced group (multiple rules sharing identical SQL + auth
identity). Each rule in the group records its **own** per-rule failure — health is per-rule
even though the query round-trip is shared.

## 3. Health state — columns on `rules`

Health is strictly 1:1 with a rule, and `rules` already carries `last_error` + `last_eval`.
Edit `migrations/0001_init.sql` in place (no back-compat). Add to the `rules` table:

```sql
health_status         TEXT NOT NULL DEFAULT 'healthy',  -- 'healthy' | 'degraded'
consecutive_failures  INT  NOT NULL DEFAULT 0,
degraded_since        TIMESTAMPTZ,
last_error_at         TIMESTAMPTZ
-- last_error TEXT and last_eval TIMESTAMPTZ already exist
```

No partial index is required; the reaper guard (§5) rides the existing `instances⋈rules`
JOIN.

## 4. Store transitions (atomic, exactly-once via the outbox)

Two new `PgStore` methods, each performing its column update and (on a transition) its
outbox write in a **single transaction**, then returning the event for the caller to
publish — mirroring the existing `upsert_instance_with_outbox` + `publish_transition`
pattern so health events inherit the same exactly-once delivery.

- `record_rule_failure(rule, scrubbed_err, threshold, now) -> Result<Option<(Event, OutboxId)>>`
  In one tx: `consecutive_failures += 1`; set `last_error`, `last_error_at`, `last_eval`.
  **If** `health_status = 'healthy'` AND `consecutive_failures >= threshold`: flip to
  `'degraded'`, set `degraded_since = now`, build the `RuleHealth`/`Firing` `Event`, insert
  it into the outbox in the same tx, return `Some((event, id))`. Otherwise `None`.

- `record_rule_success(rule, now) -> Result<Option<(Event, OutboxId)>>`
  In one tx: `consecutive_failures = 0`, `last_error = NULL`, `last_error_at = NULL`, set
  `last_eval`. **If** `health_status = 'degraded'`: flip to `'healthy'`, clear
  `degraded_since`, build the `RuleHealth`/`Resolved` `Event`, insert into the outbox,
  return `Some((event, id))`. Otherwise `None`. Called when the **query** succeeds, per
  rule, independent of the later evaluate step.

Transition rules:
- **Recovery only fires if currently degraded** — a success on a healthy rule emits nothing.
- A re-failure while already degraded re-emits nothing (no event storm); it still bumps
  `consecutive_failures` and refreshes `last_error`.
- Degrade fires exactly once, on the transition crossing K.

The event's per-rule `instance_key` is minted by a new
`InstanceKey::health(rule) -> InstanceKey` constructor: `InstanceKey::new(rule, {reserved
label})` using a reserved key the SQL label path cannot produce, so it is deterministic,
collision-free against data instances, and stable across degrade→recover.

### Evaluator wiring

In `process_batch`:
- Query-error arm (per group): for each `(job, rule)` member, call
  `record_rule_failure(rule, scrub(e), threshold, now)`; if it returns an event, publish it
  and delete the outbox row via a shared `publish_health(store, events, event, id)` helper
  (same recover-on-failure shape as `publish_transition`). Keep the existing
  `record_eval_error` log line.
- Query-success arm (per group): for each member, call `record_rule_success(rule, now)`;
  publish any returned recovery event the same way. Then proceed to
  `evaluate_rule_against_rows` as today.

`threshold` is `CC_RULE_DEGRADE_AFTER` (§11), threaded through `run_evaluator` →
`process_batch`.

## 5. The critical correctness guard

`list_stale_instances` gains `AND r.health_status <> 'degraded'`, mirroring the existing
`AND NOT r.paused`:

```sql
WHERE i.status IN ('pending','firing')
  AND NOT r.paused
  AND r.health_status <> 'degraded'
  AND i.last_seen < ($1::timestamptz - make_interval(...))
```

A degraded rule stops refreshing `instances.last_seen` (its query errors, so the evaluator
freezes), so without this guard its frozen firing instances would be reaped into a synthetic
`Resolved` after ~4 intervals — re-introducing the false all-clear from a different
direction. This is the headline safety property of the feature.

## 6. Fixed operational severity

`RuleHealth` events always carry `severity = Critical`, independent of the failing rule's own
severity. A blind `info` rule is still oncall-worthy — "the engine cannot see this rule right
now" is an operational emergency. Operators route on `kind="rule_health"`, decoupled from the
data rule's severity. Annotations carry:
- degraded: `summary = "Rule <id> degraded after <N> consecutive failures"`,
  `last_error = <scrubbed>`.
- recovered: `summary = "Rule <id> recovered"`.

## 7. Secret hygiene

- `cc_clickhouse` replaces the bare `#[from] reqwest::Error` on `ChError::Http` with an
  explicit map through `reqwest::Error::without_url()`, so `ChError` cannot carry a URL with
  embedded `user:pass@host` credentials. `ChError` becomes safe-by-construction.
- The evaluator caps `last_error` to 500 chars before storing.
- The CH username an auth-failure body may contain (`sql_api_org_<tenant>`) is derivable
  from the tenant id we already hold — not a secret. The derived **password** lives only in
  a request header and is never echoed by ClickHouse, so it cannot reach `last_error`.

## 8. Paused-rule interaction

Paused rules are dropped before evaluation (the `Ok(Some(r)) if r.paused => {}` arm in
`process_batch`), so a paused rule never reaches either health branch — it retains its last
`health_status`. The reaper double-protects it (`NOT paused` **and**
`health_status <> 'degraded'`). No additional code.

## 9. Renderers

Minimal `kind`-aware subject/title in the notify renderers (`email`, `slack`, `pagerduty`)
so a health notification reads "Rule degraded: `<id>`" / "Rule recovered: `<id>`" instead of
"FIRING `__health__`". The body uses the `summary` / `last_error` annotations already carried
by the event. No new template machinery.

## 10. API

`GET /v1/rules/:id` and the rules list gain a `health` object:

```json
"health": {
  "status": "degraded",
  "consecutive_failures": 5,
  "degraded_since": "2026-06-15T12:00:00Z",
  "last_error": "<scrubbed>",
  "last_error_at": "2026-06-15T12:04:30Z"
}
```

The rules list accepts `?health=degraded` to filter to degraded rules. No new endpoint —
health is part of a rule's representation.

## 11. Config

`CC_RULE_DEGRADE_AFTER` (u32, default `3`): consecutive query failures before a rule
degrades. Added to `src/config.rs` and threaded into the evaluator. Recovery is always on
the first success (not configurable). Global-only — no per-rule override (YAGNI; addable
later without breaking changes).

## 12. Docs

- How-to: "Observe and respond to degraded rules" (`docs/how-to/`).
- Explanation: rule health is a **separate axis** from the per-instance state machine —
  health lives on the rule, the `inactive/pending/firing/resolved` machine lives on rows.
- Update the state-machine reference page with a note pointing to the health axis.
- Document `CC_RULE_DEGRADE_AFTER` in `docs/reference/configuration.md`.

---

## Components & boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `cc_domain::event` | `EventKind`, `Event.kind`, health `Event` constructor | — |
| `cc_domain::ids` | `InstanceKey::health(rule)` | — |
| `migrations/0001` | health columns on `rules` | — |
| `cc_stores::pg` | `record_rule_failure` / `record_rule_success` (tx + outbox); health columns in get/list; reaper guard | domain |
| `cc_clickhouse` | `ChError` URL-scrubbing | reqwest |
| `cc_evaluator` | wire failure/success branches to health; cap `last_error`; thread threshold | stores, domain |
| `cc_dispatcher::routing` | `kind` synthetic label | domain |
| `cc_dispatcher` renderers | `kind`-aware subject/title | domain |
| `cc_api::rules` | `health` in rule responses; `?health=degraded` filter | stores |
| `src/config` | `CC_RULE_DEGRADE_AFTER` | — |

## Testing

- **Domain:** `EventKind` serde round-trip; `Event` carries `kind`; `InstanceKey::health`
  is deterministic and distinct from any data-instance key for the same rule.
- **Store (Postgres testcontainer):** `record_rule_failure` flips to degraded exactly when
  `consecutive_failures` reaches K and writes one outbox event; below K writes none;
  `record_rule_success` clears the counter and emits recovery only if previously degraded;
  `list_stale_instances` excludes a degraded rule's firing instances.
- **Evaluator:** K consecutive query errors emit exactly one degraded event; a subsequent
  success emits exactly one recovery; success with no prior degrade emits nothing; a
  re-failure while degraded emits nothing; health success/failure is per-rule across a
  coalesced multi-rule group.
- **ClickHouse:** a transport error's string excludes the base URL (no embedded creds).
- **Routing:** the `kind` synthetic label is matchable (`kind="rule_health"` selects a
  health route; `kind="alert"` does not).
- **API:** the `health` object is present and correct on rule GET; `?health=degraded`
  filters correctly.

## Open questions

None — all resolved during brainstorming (event model, health-state location, threshold
config, severity, API surface). Future, explicitly out of scope: per-rule degrade threshold,
a dedicated degraded-rules endpoint, per-cause classification of failures.
