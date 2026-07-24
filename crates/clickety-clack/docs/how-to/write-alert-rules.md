# How to write alert rules

A rule is a SQL `SELECT` against ClickHouse plus the metadata that turns its rows
into alert instances. This guide shows how to write effective rules and avoid the
common traps. For the exact field list see the
[data model](../reference/data-model.md#rule) and
[API reference](../reference/http-api.md#rules).

## The mental model

Each evaluation runs your SQL. **Every row returned is a firing-candidate
instance.** No rows for an instance that previously had one ⇒ that instance moves
toward resolved. So:

- Write the query so it returns rows **only when something is wrong**. Put the
  threshold in the `WHERE` clause.
- The `label_columns` pick out which columns identify an instance. Rows with
  distinct label values are independent alerts.

## Create a rule

```bash
curl -s -X POST localhost:8080/v1/rules \
  -H "X-CC-Tenant: $TENANT" -H 'Content-Type: application/json' \
  -d '{
    "name": "default/high-errors",
    "sql": "SELECT host, errors FROM error_rates WHERE errors > 100",
    "interval_secs": 30,
    "for_secs": 60,
    "label_columns": ["host"],
    "value_column": "errors",
    "severity": "critical",
    "annotations": { "runbook": "https://wiki/errors" }
  }'
```

## Choosing each field

### `name`
The rule's stable identity, unique per tenant (1 to 128 chars of
`[A-Za-z0-9_./-]`). Creating a second rule with an existing name is a `409`;
update the existing rule instead.

### `sql`
Must be a read-only `SELECT`; anything else is rejected at create time by the SQL
guard. Return the label columns (and optionally a value column). The query should
return **no rows** in the healthy state.

> **Security.** Rule SQL is executed against ClickHouse and the in-app guard only
> checks that it's a read-only `SELECT` — it does **not** stop a valid `SELECT`
> from reading other tables or reaching the network via table functions. If
> tenants you don't fully trust can create rules, you **must**
> [harden the ClickHouse user](harden-clickhouse-access.md) — that is the real
> boundary.

### `interval_secs`
The evaluation period. Drives both detection latency and ClickHouse load. Must be
`> 0`. It also feeds the auto-resolve safety net: a rule that stops being
evaluated has its firing instances reconciled to resolved after
`max(4 × interval_secs, 60s)` — so very large intervals delay that safety net.

### `for_secs` (the "for duration")
How long the condition must hold *continuously* before firing. This is your
anti-flap control:

- `for_secs: 0` — fire on the first matching evaluation.
- `for_secs: 60` with `interval_secs: 30` — must match ~2 evaluations in a row.

While waiting, the instance is `pending` (visible in `GET /v1/alerts`) but emits
no event.

### `label_columns`
The identity of an instance. Pick the columns that distinguish "different things
that can alert independently" — usually `host`, `service`, `cluster`, etc.

> Identity is derived from label **values**, hashed with the rule id. If you add
> or remove a label column later, existing instances get new identities.

### `value_column`
Optional. A numeric column carried onto events and notifications as the value. Use
it for "current error rate", "queue depth", etc. Omit it for purely boolean
conditions.

### `severity`
`info`, `warning`, or `critical`. It becomes the synthetic `severity` label, which
is what most routes, silences, and inhibitions match on.

### `annotations`
Free-form `string → string` map passed through onto every event. Not used for
matching, but four keys drive how notifications are rendered:

| Key            | Rendered as |
| -------------- | ----------- |
| `summary`      | The notification headline (Slack header, email subject, per-event lines in a grouped notification). Without it, the headline is the instance key. |
| `description`  | An additional body line under the headline. |
| `link.alert`   | A "View alert" link (Slack button, Telegram/email link). Must be an `http(s)://` URL or it is ignored. |
| `link.runbook` | A "View runbook" link, same handling as `link.alert`. |

`summary` and `description` are templates: `${<key>}` resolves, in order, to the
event's label of that name, then (for `${value}`) the event's numeric value, then
the evidence column of that name (any result column that is not a label; strings
render as-is, other JSON values as compact JSON). A key that resolves nowhere
expands to an empty string, which is also what evidence refs render when the
evidence was dropped for exceeding its caps (16 columns / 4096 bytes, see the
data model). Substitution is a single pass, so substituted values containing
`${…}` are emitted literally, and channel escaping (Slack mrkdwn, Telegram HTML)
is applied after substitution.

```json
"annotations": {
  "summary": "High error rate on ${host}",
  "description": "errors/min = ${value}",
  "link.alert": "https://app.example.com/alerts/checkout-errors",
  "link.runbook": "https://wiki.example.com/runbooks/errors"
}
```

### `resolve_after`
Consecutive **absent** evaluations required to resolve a firing instance (default
`1`). Raise it to tolerate gaps in your data — e.g. `resolve_after: 3` means three
consecutive empty evaluations before the resolve fires. Must be `>= 1`.

### `max_interval_secs` (adaptive cadence)
Optional, default off. When set (must be `>= interval_secs`, `422` otherwise),
a rule that stays quiet stops paying the full evaluation cost: after each quiet
evaluation (no rows returned, no instance pending or firing) the effective
interval doubles, starting from `interval_secs` and capped at
`max_interval_secs`. The first evaluation that returns a row, or that errors,
snaps the rule back to `interval_secs` immediately.

Use it for rules that are healthy for days at a time and where slower
detection of a *new* incident is acceptable: with `interval_secs: 30` and
`max_interval_secs: 3600`, a quiet rule drifts 30s, 60s, ..., 1h between
evaluations, and worst-case detection latency for a fresh problem becomes up
to `max_interval_secs`. A rule with any instance pending (mid `for_secs`) or
firing (including one counting absences toward `resolve_after`) never
stretches, so escalation and resolve behavior are unchanged: `for_secs` and
`resolve_after` still count evaluations at the base cadence while anything is
active. Changing `interval_secs` or `max_interval_secs` via `PUT` resets the
stretch. See the [cadence note](#evaluation-cadence-jitter-and-adaptive-backoff)
below.

### `suppressed` (preview mode)
Default `false`. A suppressed rule is a full dress rehearsal: it is scheduled,
evaluated against ClickHouse, tracks instance state, and emits firing/resolved
events into history and the OTLP alert log. The one thing it never does is
notify: the dispatcher drops its events before routing, grouping, silences,
inhibitions, and the subscription firehose, and its rule-health events are
muted the same way.

Use it to preview a rule against live data (watch `GET /v1/alerts` and the OTLP
alert log to see what it *would* have done), then flip `suppressed` to `false` via
`PUT /v1/rules/:id` to promote it. Instance state is preserved across the flip,
so a preview that is already firing starts notifying on its next transition, not
with a spurious re-fire.

> **Suppressed vs. pause vs. silence.** Pause stops the work entirely (no
> evaluation, no events). A silence keeps notifying rules quiet for a time
> window. `suppressed` keeps everything running and visible but permanently
> mutes notifications until you change the spec.

## Evaluation cadence: jitter and adaptive backoff

Two scheduler behaviors shape *when* your rule actually runs; neither changes
what it evaluates.

**Deterministic jitter (always on).** Rules tend to share round intervals
(30s, 60s, 300s), and without correction every rule on the same interval
becomes due on the same wall-clock tick and hits ClickHouse in a burst. To
spread that load, each rule gets a stable phase offset, `hash(rule id) mod
interval_secs`, applied whenever the rule is armed: on create, on resume, and
when `interval_secs` changes. In practice: the **first** evaluation lands
within one interval of creation (not instantly), and evaluations then continue
at exactly `interval_secs`, staggered relative to other rules. The offset is a
pure function of the rule id, so it survives restarts and is identical on
every scheduler replica. Use `POST /v1/rules/:id/test` when you want an
immediate answer; the schedule is for steady state.

**Adaptive backoff (opt-in per rule).** With
[`max_interval_secs`](#max_interval_secs-adaptive-cadence) set, quiet rules
evaluate less and less often, up to the cap, and snap back to `interval_secs`
the moment anything is present, pending, firing, or erroring. A firing rule is
never on a stretched interval.

## Event evidence

Every firing event carries `evidence`: the source row's columns excluding the
rule's `label_columns` (the value column is included), as raw JSON values. It
gives responders the context columns your SQL already computed without another
query. Two caps keep events bounded: at most 16 columns (extra columns are
dropped and `evidence_truncated` is set), and at most 4096 bytes of compact
JSON (over the byte cap, `evidence` becomes `null` and `evidence_truncated` is
`true`). Resolved-by-absence events have no source row, so their `evidence` is
`null` with `evidence_truncated: false`.

So: `SELECT host, errors, p99_ms, top_path FROM ... WHERE errors > 100` with
`label_columns: ["host"]` and `value_column: "errors"` yields evidence like
`{ "errors": 142, "p99_ms": 890, "top_path": "/checkout" }` on the firing event.

## Test before you commit

`POST /v1/rules/:id/test` evaluates a spec ad hoc against ClickHouse with **no
state change and no events** — ideal for tuning the SQL and threshold:

```bash
curl -s -X POST localhost:8080/v1/rules/$RULE_ID/test \
  -H "X-CC-Tenant: $TENANT" -H 'Content-Type: application/json' \
  -d '{ "sql": "SELECT host, errors FROM error_rates WHERE errors > 50",
        "interval_secs": 30, "for_secs": 0,
        "label_columns": ["host"], "value_column": "errors",
        "severity": "warning" }'
# => { "matched": 3, "rows": [ { "labels": {"host":"web-1"}, "value": 88.0 }, … ] }
```

`matched` tells you how many instances this spec would consider firing-candidates
right now. Aim for "fires when I expect, quiet otherwise."

## Patterns

- **Threshold breach:** `SELECT host, v FROM t WHERE v > 100`. Label `host`, value
  `v`.
- **Absence / dead-man:** return a row when something *should* be present but is
  not (e.g. `... WHERE last_seen < now() - INTERVAL 5 MINUTE`). Combine with a
  small `for_secs`.
- **Multi-dimension:** `label_columns: ["cluster","service"]` for per-service
  alerts within clusters; then route or inhibit on `cluster`.

## Inspect live state

```bash
curl -s localhost:8080/v1/alerts -H "X-CC-Tenant: $TENANT" | jq
```

Shows every instance with `status` (`inactive`/`pending`/`firing`), `value`,
`active_since`, `last_seen`, and `absent_count`. This is the fastest way to see
*why* an alert is or isn't firing.

## Pause a rule

To stop evaluating a rule without deleting it (maintenance, triage, cost):

```bash
curl -s -X POST localhost:8080/v1/rules/$RULE_ID/pause   -H "X-CC-Tenant: $TENANT"
curl -s -X POST localhost:8080/v1/rules/$RULE_ID/resume  -H "X-CC-Tenant: $TENANT"
```

Pause **freezes** state: evaluation (and the ClickHouse query) stops, currently
firing instances stay firing, and **no `Resolved` is emitted** — so on-call is not
told "all clear" for an unfixed problem. On resume, evaluation restarts and a real
`Resolved` fires only if the condition has actually cleared; pending instances
restart their for-duration clock.

> **Pause vs. silence.** Pause stops the *work* (no evaluation, no events).
> A [silence](suppress-with-silences-and-inhibitions.md) keeps evaluating and only
> mutes *notifications*. Use pause to stop a rule; use a silence to stay evaluating
> but go quiet.

## Next

- Deliver the alerts: [configure receivers and routing](configure-receivers-and-routing.md).
- Understand the state transitions exactly: [the evaluation model](../explanation/evaluation-model.md).
