# Clickety-Clack — Rule Pause (freeze semantics) — Design Spec

**Status:** Draft (2026-06-14)
**Predecessors:** Phases 1–3 (incl. 3A silences/inhibition, 3B durability, 3D secret encryption) — all merged to main.
**Context:** clickety-clack is a headless Rust alerting engine on ClickHouse. Operators need to temporarily stop a rule from being evaluated — for maintenance, noisy-rule triage, or cost control — without deleting it and losing its definition and instance state.

---

## Problem

There is currently **no way to stop evaluating a rule without deleting it.**

- `DELETE /v1/rules/:id` is destructive: it discards the rule and its instance state.
- A **silence** suppresses *notifications* but the rule keeps evaluating (ClickHouse load continues, firing/resolved state keeps advancing). It is the wrong tool for "stop doing the work."

The scheduler claims any rule with `next_eval <= now` (`claim_due_rules` / `claim_due_rules_sharded` in `crates/stores/src/pg.rs:163,203`); there is no predicate that can exclude a rule. The `rules` row (`migrations/0001_init.sql`) has no enable/pause flag.

## Goal

Add a per-rule **pause** that stops evaluation while preserving the rule and its current alert state, **without emitting a misleading `Resolved`**.

## The core decision: freeze, not auto-resolve

A `Resolved` event in this system is not cosmetic — it propagates to PagerDuty as a `resolve` (which **auto-closes the incident**) and to Slack as a green ✅ RESOLVED. Emitting one when the underlying condition may still be true would tell on-call "all clear" for an unfixed problem.

Industry practice splits along the pause-vs-silence line: silences/mutes (Alertmanager, Datadog, Grafana mute timings) **never** auto-resolve; check-based systems (Nagios "disable checks") **freeze** last-known state; metric systems (Prometheus, Grafana pause) let alerts **clear** because they stop asserting them. The governing principle is: *do not emit a "resolved" that means something false.* Given that a `Resolved` here closes incidents, we adopt **freeze semantics**: pause stops evaluation, leaves firing instances firing in state, and emits no event. On resume, a genuine `Resolved` fires only if/when the condition has actually cleared.

---

## Locked decisions

| Decision | Choice |
|---|---|
| Where `paused` lives | A dedicated `paused BOOLEAN NOT NULL DEFAULT false` **column on `rules`**, not inside `spec` JSONB. Pausing is operational state, not part of the rule definition, so it must not mutate the spec or bump `version`. |
| Pause effect | The rule is excluded from scheduler claiming. No evaluation runs ⇒ no ClickHouse query, no state transitions, no events. |
| Firing instances on pause | **Left firing, frozen.** No `Resolved` emitted. No notification. |
| Reconciliation interaction | Paused rules are **exempted from the stale-instance sweep** so the maintenance loop cannot synthesize a `Resolved` for a frozen alert (the critical correctness point). |
| Pending instances on resume | On resume, **reset `active_since` and `absent_count`** for the rule's `pending` instances (restart the for-duration and resolve counters), so unobserved time during the pause cannot cause a spurious immediate fire. Firing instances are untouched. *(Flagged as an open decision — see below.)* |
| API shape | Two explicit sub-action endpoints, mirroring the existing `/v1/rules/:id/test`: `POST /v1/rules/:id/pause` and `POST /v1/rules/:id/resume`. Both return the updated `Rule`. Idempotent. |
| `version` | Untouched by pause/resume (paused is not part of the spec). |
| Migration | New `migrations/0007_rule_pause.sql` adding the column. No backfill (default `false` = current behavior). |

---

## Changes by layer

### 1. Schema — `migrations/0007_rule_pause.sql`

```sql
ALTER TABLE rules ADD COLUMN paused BOOLEAN NOT NULL DEFAULT false;
-- Optional: keep the due-rule scan lean now that it carries an extra predicate.
CREATE INDEX rules_next_eval_active_idx ON rules (next_eval) WHERE NOT paused;
```

### 2. Domain — `crates/domain/src/rule.rs`

Add `paused` to the persisted `Rule` (not to `RuleSpec`):

```rust
pub struct Rule {
    pub id: RuleId,
    pub tenant: TenantId,
    pub spec: RuleSpec,
    pub version: i64,
    #[serde(default)]
    pub paused: bool,
}
```

`#[serde(default)]` keeps older serialized forms compatible. Every site that builds a `Rule` from a row selects `r.paused` (or sets `false` where the row is known-active, e.g. freshly created).

### 3. Scheduler claim — `crates/stores/src/pg.rs`

Add `AND NOT paused` to the `due` CTE in **both** claim queries:

```sql
-- claim_due_rules
SELECT id FROM rules WHERE next_eval <= $1 AND NOT paused
  ORDER BY next_eval LIMIT $2 FOR UPDATE SKIP LOCKED

-- claim_due_rules_sharded
SELECT id FROM rules
  WHERE next_eval <= $1 AND NOT paused
    AND (((hashtext(tenant::text)::bigint % $3) + $3) % $3)::int = ANY($4)
  ORDER BY next_eval LIMIT $2 FOR UPDATE SKIP LOCKED
```

The `paused` flag is the **single** gate — we do **not** also park `next_eval` in the future. One source of truth.

### 4. Reconciliation exemption — `crates/stores/src/pg.rs:794` `list_stale_instances`

Add `AND NOT r.paused` so frozen alerts under a paused rule are never auto-resolved:

```sql
FROM instances i JOIN rules r ON r.id = i.rule
WHERE i.status IN ('pending','firing')
  AND NOT r.paused
  AND i.last_seen < ($1::timestamptz - make_interval(secs => GREATEST(4 * (r.spec->>'interval_secs')::int, 60)))
```

Without this, a paused rule's firing instances would go stale after `max(4×interval, 60s)` and the maintenance sweep would emit exactly the misleading synthetic `Resolved` this design exists to prevent.

### 5. Store mutators — `crates/stores/src/pg.rs`

```rust
/// Set paused=true. Idempotent. Returns false if no such rule for the tenant.
pub async fn pause_rule(&self, tenant, id) -> Result<bool, StoreError>;
//   UPDATE rules SET paused = true,  updated_at = now() WHERE tenant=$1 AND id=$2

/// Set paused=false and re-arm: next_eval=now so it evaluates promptly; reset the
/// rule's pending instances' for-duration/absent counters. One transaction.
pub async fn resume_rule(&self, tenant, id) -> Result<bool, StoreError>;
//   UPDATE rules SET paused=false, next_eval=now(), updated_at=now() WHERE …
//   UPDATE instances SET active_since=NULL, absent_count=0 WHERE rule=$id AND status='pending'
```

Both return the row-existence boolean so the API can map to `404`.

### 6. API — `crates/api/src/rules.rs` + router (`crates/api/src/lib.rs:40`)

```rust
.route("/v1/rules/:id/pause",  post(rules::pause))
.route("/v1/rules/:id/resume", post(rules::resume))
```

Handlers are tenant-scoped (from `X-CC-Tenant`), call the store mutator, and on
success re-`get_rule` and return the updated `Rule` (`200`); missing id ⇒ `404`
`not_found`. No request body. Pausing an already-paused rule (or resuming an
active one) is a `200` no-op.

---

## State semantics (the precise contract)

| Instance status at pause | During pause | At resume |
|---|---|---|
| `firing` | stays `firing`, frozen; **no event**, no notification | next evaluation runs normally; emits `Resolved` only if the row is genuinely absent for `resolve_after` evals |
| `pending` | stays `pending`, frozen | `active_since`/`absent_count` reset → for-duration restarts from resume (no fire from unobserved time) |
| `inactive` | unchanged | unchanged |

- `POST /v1/rules/:id/test` still works on a paused rule (ad-hoc eval, no state) — unaffected.
- `GET /v1/alerts` still lists a paused rule's instances with their frozen status.

---

## Out of scope (v1)

- **Bulk pause** (per-tenant, or pause-by-matcher). Single-rule only for now.
- **Auto-resume** (pause-until-timestamp). Manual resume only. (A timed pause could reuse the silence `ends_at` pattern later.)
- **Surfacing `paused` on the `/v1/alerts` instance view** — operators correlate via rule id; can add a `rule_paused` flag later if wanted.
- **Auto-pause on repeated evaluation failure** (flap/error circuit-breaker) — separate feature.

---

## Open decisions for sign-off

1. **Pending-instance reset on resume (decision #5 above).** Recommended **on** (safer: no fire from unobserved time, consistent with "pause = I wasn't looking"). Turning it **off** is simpler and matches how the system already behaves across an unplanned scheduler gap — but makes a long pause able to fire a `pending` instance immediately on resume. *Recommend: keep it on.*
2. **API verb shape.** Recommended `POST …/pause` + `…/resume` (matches `…/test`). Alternative: a single `PATCH /v1/rules/:id` taking `{ "paused": bool }`. The repo has no `PATCH` today, so two POSTs fit the existing style. *Recommend: two POSTs.*
3. **Index.** The partial index in §1 is optional; the `rules` table is small in current deployments. *Recommend: include it — cheap insurance as rule counts grow.*

---

## Test plan

- **Store/unit:** `pause_rule`/`resume_rule` idempotency + tenant scoping + `404` path; `claim_due_rules{,_sharded}` skip paused rules (integration, Postgres testcontainer); `list_stale_instances` excludes paused rules' instances.
- **Behavioral (integration):** pause a firing rule → no further events, instance stays firing; advance well past `max(4×interval,60s)` and run the maintenance sweep → **no** synthetic `Resolved` (this is the regression guard for the core decision); resume → evaluation resumes and a real `Resolved` fires once the condition clears.
- **Pending reset:** pause a `pending` instance, wait past its for-duration, resume → it does **not** immediately fire; it re-enters the for-duration from resume.
- **API:** pause/resume happy path returns updated `Rule` with `paused` set; pause of unknown id → `404`; double-pause → `200` no-op.
- **Docs:** add a "Pause a rule" how-to and note pause vs silence in `docs/how-to/write-alert-rules.md` and the data-model/API reference.

---

## Why this shape

| Choice | Rationale |
|---|---|
| Freeze, no auto-resolve | A `Resolved` closes PD incidents / shows green in Slack; emitting one on pause would falsely signal "fixed". |
| Reconciliation exemption | Otherwise the maintenance sweep would re-introduce the exact misleading resolve via the back door. |
| Column, not spec field | Pause is operational, must not bump `version` or alter the rule's logical definition. |
| Single gate (`paused`), not parked `next_eval` | One source of truth; resume is a flag flip, not a timestamp reconciliation. |
| Pending reset on resume | Honors for-duration's "held continuously" contract across an intentional observation gap. |
