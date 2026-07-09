# How to observe and respond to degraded rules

An alerting engine has a blind spot of its own: if a rule's evaluation **query** keeps
failing, that rule silently stops producing truthful results. clickety-clack surfaces this
as a first-class, routable signal — **rule health** — so on-call finds out.

For *why* this is a separate axis from the alert state machine, see
[the evaluation model](../explanation/evaluation-model.md#rule-health--a-separate-axis).

## What "degraded" means

A rule goes **degraded** after `CC_RULE_DEGRADE_AFTER` (default `3`) *consecutive*
evaluation-query failures. Causes include:

- ClickHouse unreachable, connection refused, or a query timeout (`max_execution_time`).
- A `SELECT` referencing a dropped or renamed column or table (schema drift).
- A result-row cap hit (`max_result_rows` with `result_overflow_mode='throw'`).
- In per-tenant auth (`derived`/`map` mode), a tenant whose ClickHouse user was never
  provisioned — every evaluation auth-fails. See
  [harden ClickHouse access](harden-clickhouse-access.md).

A single blip does not page: the rule must fail `CC_RULE_DEGRADE_AFTER` times in a row.
The **first** successful evaluation clears the degraded state and emits a recovery.

While degraded, the rule's existing alert instances are **frozen** — never evaluated
against absent rows, and never auto-resolved by the stale-instance sweep — so a broken
query cannot produce a false all-clear.

## Route degraded notifications to on-call

Rule-health events flow through the **same** routing/grouping/silencing pipeline as data
alerts, distinguished by a synthetic `kind` label and a fixed `critical` severity (a blind
`info` rule is still an operational emergency). Add a route that matches `kind="rule_health"`:

```json
{
  "matchers": [{ "label": "kind", "op": "eq", "value": "rule_health" }],
  "receiver": "oncall"
}
```

Put it before catch-all routes, or set `continue: true` if you also want health events to
fall through to other receivers. Notifications render as `Rule degraded: <id>` /
`Rule recovered: <id>` with the underlying error in the body.

## Tune the notification cadence

Health events flow through the same grouping as data alerts, and grouping is **load-bearing**
here: when ClickHouse is unreachable, *every* rule degrades at once — grouping collapses that
into a single "N rules degraded" notification instead of one email per rule. So you want
grouping on, just tuned for health.

The catch with the defaults: a group's first notification fires after `group_wait` (prompt),
but every *subsequent* change to that group — including the **recovery** — fires only at the
next `group_interval` tick (default **300s**). That's standard Alertmanager behaviour, but it
means a recovered rule can take up to 5 minutes to send its all-clear. For an operational
health signal you usually want the recovery to track your fix more closely.

Set the cadence on the route rather than in the engine:

```jsonc
{
  "matchers": [{ "label": "kind", "op": "eq", "value": "rule_health" }],
  "receiver": "oncall-health",
  "group_by": ["kind"],          // batch all degraded rules into one notification (de-storms a CH outage)
  "group_wait_secs": 10,         // prompt first page
  "group_interval_secs": 60      // recovery / updates within ~1 min, not 5
}
```

The two knobs:

- **`group_interval_secs`** — lower means prompter recovery, but more frequent re-pages during
  a sustained outage. **30–60s** is a good range for health.
- **`group_by`** — `["kind"]` batches all health into one notification (best for a mass outage);
  `["rule"]` isolates each rule (prompter per-rule, but an outage fans out to one per rule).

## Silence health notifications

A degraded rule you already know about can be muted like any other alert — with a silence
matching `kind="rule_health"` (optionally narrowed by `rule=<id>`):

```json
{ "matchers": [
  { "label": "kind", "op": "eq", "value": "rule_health" },
  { "label": "rule", "op": "eq", "value": "<rule-id>" }
] }
```

See [suppress with silences and inhibitions](suppress-with-silences-and-inhibitions.md).

## Inspect health via the API

Each rule carries its health on the standard rule representation:

```
GET /v1/rules/{id}
{
  "id": "...", "spec": { ... },
  "health": {
    "status": "degraded",
    "consecutive_failures": 5,
    "degraded_since": "2026-06-15T12:00:00Z",
    "last_error": "clickhouse returned status 516: ...",
    "last_error_at": "2026-06-15T12:04:30Z"
  }
}
```

To find every currently-degraded rule for a tenant:

```
GET /v1/rules?health=degraded
```

The filter accepts `degraded` or `healthy`; any other value returns `422`.

## Respond

1. Read `last_error` on the degraded rule to see the failure.
2. Fix the cause — restore ClickHouse, repair the SQL after a schema change, provision the
   tenant's ClickHouse user, or widen a too-tight result cap.
3. The next successful evaluation flips the rule back to `healthy` and sends a recovery
   notification. The rule's frozen alert instances resume normal evaluation; a recovery does
   **not** retroactively resolve them — their truth is re-established by the next evaluation.

## Related configuration

- `CC_RULE_DEGRADE_AFTER` — failures before degrading. See
  [configuration](../reference/configuration.md#rule-health).
