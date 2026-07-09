# Rule Health & Degraded-State Notifications — PRE-SPEC CONTEXT NOTES

> **Status: NOT a design. NOT approved.** This is a context-capture document for a
> *future* brainstorm. It exists so that the eventual Spec B session starts with all
> the reasoning we already did, rather than re-deriving it. When you brainstorm this
> for real, run it through the normal brainstorming → spec → plan flow and produce a
> dated `*-design.md`. Treat everything here as input, not conclusions.

This was split out of the **per-tenant ClickHouse auth** work (Spec A,
`2026-06-14-per-tenant-clickhouse-auth-design.md`). The two only touch at one point:
result-row truncation is *one* cause of an evaluation failure. Everything below stands
alone and is valuable even with zero per-tenant work.

---

## The gap (motivation)

When a rule's evaluation query fails — ClickHouse down, a `SELECT` referencing a
dropped column, a timeout, a result-row cap hit (`max_result_rows` with the default
`result_overflow_mode='throw'` raises an error), or (in Spec A's `derived`/`map` mode)
a misprovisioned per-tenant CH user — the failure is **recorded silently and never
surfaced**. An operator has no signal that a rule has stopped producing truthful
results. A rule can be "broken" (every evaluation erroring) for hours and on-call
never knows. For an *alerting* system that is a serious blind spot: the thing whose
job is to tell you when something is wrong is itself silently wrong.

## What already exists today (verified, do not rebuild)

- **Freeze-on-error is already correct.** `crates/evaluator/src/lib.rs:122-129`: on a
  query error the evaluator logs, calls `store.record_eval_error(rule, &e.to_string())`,
  and `continue`s. It **never** runs `evaluate_rule_against_rows` for that group, so the
  absence path does not fire and **instances are left frozen exactly as they were**. A
  ClickHouse outage or a truncation error therefore *cannot* drain firing alerts to a
  misleading `Resolved`. **We do NOT need to build freeze semantics — they already hold.**
  (This is the same insight behind the Rule Pause feature: never emit a false all-clear.)
- **A silent per-rule error sink already exists:** `store.record_eval_error(rule, msg)`.
  Spec B is largely about **elevating this existing sink** into something observable and
  notifiable — not building error handling from scratch.
- The per-rule absence/resolve machinery, the dispatch pipeline (routing, receivers,
  grouping, dedup, silences, inhibitions), and the event bus all already exist and should
  be **reused**, not duplicated.

## Modeling decisions reached during the split discussion

These were argued through and are the recommended starting positions for the brainstorm
(but re-validate them — they are not user-approved):

1. **Rule-health is a separate dimension, NOT a new instance state.** The instance state
   machine (`inactive / pending / firing / resolved`) lives on *rows*. A query error has
   no row to attach to. So model health on the **rule**: a `healthy ↔ degraded` status
   with fields like `consecutive_failures`, `degraded_since`, `last_error`. It sits
   *beside* the instance machine, not inside it. Do not entangle the two.

2. **Debounce before degrading.** A single blip (CH restart, a 2s timeout) must not page.
   Degrade only after **K consecutive failures** — mirrors the existing `for_secs` /
   `resolve_after` debounce idioms. K should probably be configurable (global default,
   maybe per-rule override — decide in brainstorm; YAGNI the per-rule override unless asked).

3. **Recovery clears degraded but emits NO fake alert `Resolved`.** When a query succeeds
   again, clear `degraded` and emit a *health-recovered* signal. This must **not** touch
   the underlying alert instances — they were frozen, we never learned their truth, so
   there is nothing to resolve. Recovery is a rule-health event only.

4. **Notify through the EXISTING event/dispatch pipeline, not a hardcoded email path.**
   Emit distinct event types (working names `RuleDegraded` / `RuleRecovered`) with their
   own severity, and let operators route them — email, Slack, PagerDuty — via the routing
   they already configure. No new delivery mechanism. ("Fire emails" was the user's
   framing; the generic answer is "fire a routable event, operator picks the channel.")

## Causes of evaluation failure this covers (the surface)

- ClickHouse unreachable / connection refused / timeout (`max_execution_time`).
- Result-row cap hit (`max_result_rows` throw) — **the link to Spec A** (everr's
  `sql_api_profile` caps `max_result_rows=1000`, likely too tight for alerting; a rule
  returning >1000 firing instances errors instead of silently truncating — good, but it
  must then surface as degraded).
- SQL that references a dropped/renamed column or table (schema drift).
- Permission errors: in Spec A `derived`/`map` mode, a tenant whose CH user was never
  provisioned auth-fails every evaluation. Spec B is how that becomes visible at runtime;
  Spec A separately proposes a **preflight on rule-create** so it fails loudly *up front*
  instead. The two are complementary: preflight catches it at create time, degraded
  catches it if it breaks later.
- Memory/row-scan caps (`max_memory_usage`, `max_rows_to_read`).

## Relationships / cross-spec links

- **Spec A (per-tenant auth):** truncation + auth-misprovision are causes that land here.
  Spec A's `server_enforced_limits` and the `max_result_rows` concern feed this. Spec A's
  rule-create preflight reduces — but does not eliminate — the need for runtime degraded
  detection.
- **Rule Pause (already shipped):** reuse its freeze insight. Note the *difference*:
  pause is an operator *choosing* to stop a rule (no events at all); degraded is the rule
  *involuntarily* failing (should notify). A paused rule that would otherwise error should
  presumably **not** go degraded (it isn't being evaluated) — confirm this interaction.
- **Secret hygiene (Phase 3D):** `record_eval_error` stores `e.to_string()`. In `derived`
  mode a ClickHouse auth error string could embed the tenant CH **username**
  (`sql_api_org_<tenant>`) — and we must be certain it never embeds the derived
  **password**. Apply the same scrubbing discipline used for transport errors in notify
  (`.without_url()` pattern). Audit the error string before it is stored or notified.

## Likely surface area when this is built (for sizing — not a plan)

- **Schema:** add health columns to `rules` (or a `rule_health` side table):
  `health_status`, `consecutive_failures`, `degraded_since`, `last_error`,
  `last_error_at`. A migration.
- **Domain:** a `RuleHealth` type; `RuleDegraded` / `RuleRecovered` event variants on the
  `Event` enum (`crates/domain/src/event.rs`).
- **Evaluator:** the error branch (`lib.rs:122-135`) increments the failure counter and,
  on crossing K, emits `RuleDegraded`; the success branch resets the counter and, if
  previously degraded, emits `RuleRecovered`. Both go through `publish_transition`/outbox
  so they inherit exactly-once-ish delivery.
- **Dispatcher / routing:** ensure the new event types flow through routing + receivers.
  Decide whether silences/inhibitions apply to health events (probably silences yes,
  inhibitions n/a).
- **API:** surface health in `GET /v1/alerts` or a dedicated `GET /v1/rules/:id/health`
  (or a `?health=degraded` filter on the rules list). Decide in brainstorm.
- **Config:** `CC_RULE_DEGRADE_AFTER` (K consecutive failures, default e.g. 3).
- **Docs:** new how-to ("observe and respond to degraded rules") + an explanation section
  in the evaluation model; update the state-machine docs to clarify health is a separate
  axis.

## Open questions to settle in the real brainstorm

- K default value, and whether per-rule override is worth it (lean YAGNI: global only).
- Does a `RuleRecovered` event get sent if no `RuleDegraded` was ever sent? (No —
  recovery only fires if currently degraded.)
- Should degraded suppress *new* `Firing` events that might come from a *partial* success,
  or is it strictly all-or-nothing per evaluation? (Evaluation is all-or-nothing today —
  the whole group errors or succeeds — so likely a non-issue, but confirm with coalescing
  changes from Spec A, which key by tenant.)
- Severity of health events: fixed, or derived from the rule's own severity? (Probably a
  fixed, separate "operational" severity — a broken `info` rule may still be urgent.)
- Interaction with paused rules (see above) — paused rules should not go degraded.
- Retention/auto-clear: if a rule is deleted while degraded, ensure no dangling health
  notifications.
- Does the maintenance/stale-instance relay need to know about health (e.g. should it
  *not* auto-resolve instances belonging to a degraded rule)? Cross-check
  `list_stale_instances` and the auto-resolve safety net — a degraded rule's instances
  must not be reaped as "stale" and resolved, which would re-introduce the false
  all-clear from a different direction. **This is the most important correctness check.**
