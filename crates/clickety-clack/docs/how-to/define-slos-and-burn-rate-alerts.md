# How to define SLOs and burn-rate alerts

An SLO is a SQL query that reports `good`/`valid` counts over a rolling window,
plus the metadata that turns its error budget into multi-window burn-rate
alerts. It reuses the same engine, instance state machine, and notification
pipeline as rules: an SLO tier firing is an ordinary alert instance under the
hood. This guide shows how to define one. For the exact field list see the
[data model](../reference/data-model.md#slo) and
[API reference](../reference/http-api.md#slos).

## The mental model

Each evaluation tick runs your SLI query per due window (windows recompute on a
staggered, coordinated cadence: see [below](#evaluation-cadence)) and derives,
per label group: the SLI ratio, the error budget remaining, and a burn rate for
each tier. A tier "fires" when its long **and** short window burn
rates both exceed its threshold: exactly the multi-window burn-rate pattern
from the Google SRE workbook. So:

- Write the SLI query so `good`/`valid` reflect "how much traffic was good vs.
  how much traffic counted at all", not a threshold. The threshold lives in
  the tier's `burn_rate`, not your SQL.
- `label_columns` fan the SLO out into independent per-group budgets/burns:
  same role as a rule's `label_columns`.

## The SLI contract

The `sli.sql` must be a single read-only `SELECT` with no query-level
`SETTINGS` clause (multi-statement SQL is rejected, validated by the same SQL
guard as rules) that returns:

- a `good` column: numeric count of qualifying "good" events in the window;
- a `valid` column: numeric count of all events that count toward the SLI
  (the denominator);
- optionally, one column per entry in `label_columns`.

The engine injects the window as two ClickHouse named parameters,
`{window_start:DateTime}` and `{window_end:DateTime}`; **both must appear
literally in the SQL** or creation is rejected `422`: a query missing one
would ignore the window and scan unboundedly.

> **Security.** Like rule SQL, the guard only checks the statement's shape.
> It does **not** stop a valid `SELECT` from reading other
> tables or reaching the network via table functions. If tenants you don't
> fully trust can create SLOs, you **must**
> [harden the ClickHouse user](harden-clickhouse-access.md).

`label_columns` may not include any column starting with `__cc_` (reserved,
mirrors rule validation), nor the names `slo` or `slo_tier` (labels the SLO
pipeline itself injects).

### Window duration cap

The budget `timeWindow.duration` is capped at **366 days** (`366 * 86400`
seconds) and floored at **1 day** (below a day the scaled tiers collapse onto
the same short-window floor and the multi-window method degenerates). A
duration outside the bounds is rejected `422` with a message naming the
offending value and the bound. v1 only supports rolling windows:
`timeWindow.isRolling` must be `true` and `calendar` must be omitted, else
`422` ("calendar-aligned windows are not supported in v1").

Supported duration units are `s`, `m`, `h`, `d`, `w`
(seconds/minutes/hours/days/weeks): the same shorthand as elsewhere in the
engine. Calendar units (`M`, `Q`, `Y`) are rejected.

## Create an SLO

```bash
curl -s -X POST localhost:8080/v1/slos \
  -H "X-CC-Tenant: $TENANT" -H 'Content-Type: application/json' \
  -d '{
    "name": "checkout-availability",
    "sli": {
      "sql": "SELECT countIf(status < 500) AS good, count() AS valid FROM http_requests WHERE service = '"'"'checkout'"'"' AND ts >= {window_start:DateTime} AND ts < {window_end:DateTime}",
      "label_columns": []
    },
    "targetPercent": 99.9,
    "timeWindow": { "duration": "30d", "isRolling": true },
    "min_valid_events": 100,
    "annotations": { "runbook": "https://wiki/checkout-slo" }
  }'
```

Note the field-naming split: `targetPercent`/`timeWindow`/`isRolling` are
OpenSLO-aligned camelCase (this spec deliberately tracks the OpenSLO field
names); `sli`, `label_columns`, `min_valid_events`, `annotations`, and
`suppressed` are plain snake_case, matching the rest of the engine's spec
shapes. The response is the stored `Slo`: `{ id, tenant, namespace, name, spec,
version, paused }`: same envelope shape as a rule. `GET` and list return an
`SloView` that adds two read-only bookkeeping fields, `updated_at` and
`budget_epoch`.

## Tiers: the canonical three, scaled to your window

Tiers are **not part of the spec**: every SLO is evaluated with the canonical
three-tier multi-window burn-rate policy, calibrated to a 30-day budget
window. (A `tiers` field in a request body is an unknown field and is silently
ignored.)

| Tier        | Long window | Short window | Burn rate | Severity |
| ----------- | ----------- | ------------ | --------- | -------- |
| `fast-burn` | `1h`        | `5m`         | `14.4×`   | critical |
| `slow-burn` | `6h`        | `30m`        | `6×`      | critical |
| `ticket`    | `3d`        | `6h`         | `1×`      | warning  |

A tier fires only when **both** its long-window and short-window burn rates
strictly exceed `burn_rate`: the short window is what lets a resolved spike
stop paging immediately instead of waiting out the long window.

A window that returns no rows is neither: it produces no burn rate at all, so
the tick carries no verdict and the tier keeps whatever state it already had.
An idle tier stays idle (a gap never pages you) and a firing tier keeps firing
(a gap is not evidence of recovery). This matters most on small budget windows,
where the scaled short window is short enough that a quiet minute, or telemetry
that has not finished landing, can empty it.

For a budget window other than 30 days, each tier's windows scale
proportionally (by `timeWindow / 30d`) while the thresholds stay put, keeping
the fraction of budget consumed over each long window (2%/5%/10%) constant at
any window size. Sensitivity is therefore tuned through `targetPercent` and
`timeWindow`, not by editing tiers.

Below roughly a 6-day budget window that proportionality gives way to a floor.
A scaled short window is never allowed under 1 minute, and when the floor kicks
in the tier's long window is pinned to 12× the floor to preserve the canonical
long:short ratio (the short window is the anti-flap signal, so its ratio to the
long one is worth more than exact proportionality). A floored tier therefore
watches a larger slice of the budget than its threshold was calibrated for, and
fires later than the table above implies.

At a 1-day window the floor makes `fast-burn` land on exactly `slow-burn`'s
scaled windows (12m/1m). Two tiers watching identical windows are one detector
at two sensitivities, so only the lower threshold is kept: a 1-day SLO
evaluates **two** tiers, `slow-burn` (12m/1m, 6×, critical) and `ticket`
(144m/12m, 1×, warning). Nothing is lost, because on identical windows the 6×
tier fires whenever the 14.4× one would and earlier, at the same severity.

Tiers are precedence-ordered fastest-first; a faster tier firing inhibits its
slower siblings for the same group (spec §5) via inhibition rules the
dispatcher synthesizes automatically from the canonical tiers: you don't
create these inhibitions yourself. So you are not paged separately by
`slow-burn` and `ticket` for the same underlying budget burn once `fast-burn`
is already firing.

## `min_valid_events`

Optional floor (default off/`null`) on the **long window**'s observed `valid`
count. When set, a tier cannot fire unless the long window's `valid` count is
`>= min_valid_events`, even if both burn rates are over threshold. Use it for
low-traffic services where a handful of requests can swing the SLI wildly:
without a floor, one failure out of five requests is a 20%-bad window, which
against a 99.9% target (a 0.1% budget) is already a 200× burn rate, comfortably
enough to trip `fast-burn`'s 14.4× threshold on five requests' worth of noise.

There is no auto-derived "smart" default: leaving it `null` means tiers fire
purely on burn rate, with no floor.

The floor distinguishes two cases. A `valid` count that is present but under the
floor is a real measurement you asked the engine not to act on, so it reads as
"not breaching" and will resolve a firing tier. A **missing** (`None`) valid
count is no measurement at all, so it carries no verdict and holds the tier's
state, exactly like a missing burn rate.

## Test before you commit

`POST /v1/slos/:id/test` (`:id` is ignored, like `rules::test`) is a dry-run:
it validates the posted spec, runs the SLI query once over the spec's **own**
`timeWindow` against ClickHouse, and returns the per-group SLI: **no DB
write, no snapshot, no instance/event side effects**:

```bash
curl -s -X POST localhost:8080/v1/slos/$SLO_ID/test \
  -H "X-CC-Tenant: $TENANT" -H 'Content-Type: application/json' \
  -d '{ "name": "checkout-availability", "sli": { "sql": "...", "label_columns": [] },
        "targetPercent": 99.9, "timeWindow": { "duration": "30d", "isRolling": true } }'
# => { "matched": 1, "groups": [ { "labels": {}, "good": 998234.0, "valid": 1000000.0, "sli": 0.998234 } ] }
```

`sli` is `good / valid`, or `null` when `valid` is `0` (no traffic in the test
window, not an error). Use it the same way you'd use `POST /v1/rules/:id/test`:
tune the SQL and target against live data before committing.

## Reading `/status`

`GET /v1/slos/:id/status` returns the evaluator's latest computed snapshot,
enriched at **read time only**: nothing computed here is written back:

```json
{
  "computed_at": "2026-07-17T12:00:00Z",
  "payload": {
    "window": "30d",
    "target_percent": 99.9,
    "groups": [
      {
        "labels": {},
        "sli": 0.9987,
        "budget_remaining": 0.42,
        "tiers": [
          { "name": "fast-burn", "long_burn_rate": 2.1, "short_burn_rate": 1.8, "long_window_valid": 210000.0 },
          { "name": "slow-burn", "long_burn_rate": 1.9, "short_burn_rate": 1.7, "long_window_valid": 1260000.0 },
          { "name": "ticket",    "long_burn_rate": 1.2, "short_burn_rate": 1.1, "long_window_valid": 30240000.0 }
        ],
        "time_to_exhaustion_secs": 1123200,
        "firing_tiers": [ { "tier": "ticket", "status": "firing" } ]
      }
    ],
    "window_computed_at": { "300s": 1752753600, "3600s": 1752750000 }
  },
  "health": { "status": "healthy", "degraded_since": null, "last_error": null }
}
```

- **`sli`** / **`budget_remaining`** are over the SLO's own `timeWindow`
  (the budget window); `null` at zero traffic in that window.
- **`tiers[]`** carries each tier's long/short burn rate and the long window's
  `valid` count (the input to `min_valid_events`'s floor).
- **`time_to_exhaustion_secs`** is computed at read time from the group's
  `budget_remaining` and the current burn: the **first** tier with a computed
  long-window burn (tiers are fastest-first, so that's the freshest
  sustained-burn read) supplies `min(long_burn_rate, short_burn_rate)`, and
  **both** windows must be present; a missing short burn yields `null`, so the
  horizon drops the moment spending stops. Also `null` when either input is
  missing or the burn rate is `<= 0` (nothing burning); `0` when the budget is
  already exhausted.
- **`firing_tiers`** lists this group's currently non-`inactive` tier
  instances (`pending` or `firing`), read from the same instance store backing
  `GET /v1/alerts`.
- **`health`** is the SLO's own health axis: same semantics as
  [rule health](observe-degraded-rules.md) but a leaner shape (only `status`,
  `degraded_since`, and `last_error`; no `consecutive_failures` or
  `last_error_at`), reusing the **same**
  `CC_RULE_DEGRADE_AFTER` threshold (see
  [configuration](../reference/configuration.md#rule-health)): the SLO
  degrades after that many consecutive SLI-query failures, and while degraded
  its existing tier instances are frozen rather than evaluated against absent
  data. Recovery is the first successful evaluation, same as a rule.

**A stored payload that fails to deserialize into the current shape is served
back unmodified, without enrichment, instead of erroring the endpoint.** The
read path never `500`s on a payload it cannot parse; if you see a `groups[]`
entry without `time_to_exhaustion_secs`/`firing_tiers`, that's why. It isn't a
bug, it's the fallback for an unparseable row.

## Pause vs. suppressed

**Pause** (`POST /v1/slos/:id/pause` / `.../resume`) stops the SLO's
evaluation entirely: the scheduler stops claiming it, no SLI query runs, the
stored status snapshot is left exactly as-is, and no tier instance is touched,
so a currently-firing tier stays firing and **no resolved event is
emitted**, exactly like [pausing a rule](write-alert-rules.md#pause-a-rule).
Resume re-arms scheduling; the next evaluation re-establishes the truth (a
resolved fires only if the budget has genuinely recovered).

**`suppressed`** (default `false`) is preview mode: the SLO evaluates fully,
tracks tier instance state, and writes its status snapshot and history exactly
as normal: it just never notifies. Every event it would have fired still
carries `suppressed: true` and still reaches the OTLP alert log; the
dispatcher drops it before routing/grouping/silences/inhibitions.
Flip it to `false` via `PUT /v1/slos/:id` to promote a preview SLO to live;
instance state carries over, so an already-firing preview starts notifying on
its next transition rather than re-firing.

> **Pause vs. suppressed vs. silence.** Pause stops the work (no evaluation,
> no snapshot updates). `suppressed` keeps everything running and visible but
> mutes notifications. A silence mutes notifications for a time window without
> touching evaluation at all. Same three-way distinction as rules.

## Evaluation cadence

Unlike rules, an SLO has no per-resource `interval_secs`: every SLO in a
tenant is claimed by the scheduler on the same fixed cadence,
`CC_SLO_BASE_CADENCE_SECS` (default `30s`). Creation (and resume) arms the
first evaluation at a deterministic jitter phase within one cadence
(`hash(slo_id) % base_cadence`, same mechanism as rules), so a bulk apply
spreads across the cadence instead of stampeding ClickHouse on one tick. Within one evaluation, not every
window recomputes on every tick: each of a tier's long/short windows (plus the
budget window) refreshes only when it's "due": `max(base_cadence,
window_secs / 12)` since it was last computed, so a `30d` budget window is
rescanned roughly every 2.5 days, not every 30 seconds, while a `5m` tier
window refreshes every tick. `window_computed_at` in the status payload is
this per-window freshness ledger.

## Pair every SLO with a dead-man rule

**A request-based SLI has a blind spot: total traffic loss.** If a service
serves zero requests, `valid` is `0`, the SLI is undefined, and burn rate is
`None`: the fail-open behavior every tier already has for zero traffic (you
never want to page because a healthy-looking service served nobody). But a
service that has gone *completely dark*: crashed, unrouted, or
network-partitioned: also serves zero requests. From the SLI's point of view, "no
traffic" and "perfectly healthy at zero volume" are indistinguishable. An SLO
measures the **quality of served traffic**, not the **presence of traffic**,
and it cannot measure what it never observed.

This is a documented, out-of-scope gap, not a bug to work around in the SLI
query. The fix is a second, independent signal: an ordinary absence/dead-man
**rule** that pages when traffic itself disappears, paired 1:1 with the SLO it
protects.

```json
{
  "sql": "SELECT service, requests FROM (SELECT 'checkout' AS service, count() AS requests FROM http_requests WHERE service = 'checkout' AND ts > now() - INTERVAL 5 MINUTE) WHERE requests = 0",
  "interval_secs": 60,
  "for_secs": 120,
  "label_columns": ["service"],
  "value_column": "requests",
  "severity": "critical",
  "annotations": {
    "summary": "No traffic observed for ${service}",
    "description": "checkout-availability's SLI has gone silent: this is a traffic-presence check, not a quality check.",
    "runbook": "https://wiki/checkout-slo"
  }
}
```

This is the same "Absence / dead-man" pattern from
[write alert rules](write-alert-rules.md#patterns): the query returns a row
only when the count is zero, so it's silent while traffic flows and fires the
moment it stops. `for_secs: 120` with `interval_secs: 60` requires two
consecutive silent minutes before paging, absorbing a single missed scrape.

**This pairing is mandatory, not optional guidance.** Any tooling or
automation: provisioning scripts, CLI wrappers, agent-driven SLO
authoring: that creates an SLO **must prompt the operator to also create
this companion rule** at the same time. An SLO with no dead-man companion has
a real, silent blind spot: it will look perfectly healthy through the exact
outage you most need to know about.

## Next

- Deliver SLO tier alerts: they route, group, and inhibit like any other
  alert: see [configure receivers and routing](configure-receivers-and-routing.md)
  and [suppress with silences and inhibitions](suppress-with-silences-and-inhibitions.md).
- Observe SLO health the same way as rule health: [observe degraded rules](observe-degraded-rules.md).
