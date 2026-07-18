# Alerts

Alerts are defined as code: `kind: AlertRule` YAML files reconciled with `everr apply`, the same gitops flow as dashboards and runbooks — see the skill root for the manifest, file layout (`*.alert.yaml`), and apply semantics. The query is the condition — every row it returns is a firing instance, and an empty result means resolved.

Prerequisite: telemetry already flowing into Everr (traces, logs, or metrics).

## AlertRule Schema

```yaml
kind: AlertRule              # required literal
metadata:
  name: <slug>               # required; stable alert identity
  project: <slug>            # optional; namespace, default "default"
spec:
  runbook: <slug>            # optional; links a runbook. "slug" = same
                             #   project; "project/slug" = another project.
                             #   (legacy `notebook:` still accepted.)
  display:                   # optional
    name: <human name>
    description: <text>
  evaluationInterval: 5m     # required; format: <int><s|m|h|d>, minimum 1m
  for: 0s                    # optional; condition must hold this long before
                             #   firing. Default 0s (fire immediately).
  resolveAfter: 1            # optional; consecutive empty evaluations before a
                             #   firing instance resolves. Default 1, min 1.
  notificationMessage:
    title: "${ServiceName} is failing"  # required; supports ${column} and ${value}
    description: "${value} errors in the last window"  # optional; same templating
  query: |                   # required (or its alias `sql`); ClickHouse SQL,
                             #   no ${...} templating. Set exactly one of
                             #   `query` or `sql`, not both.
    SELECT ...
  instanceLabels: [ServiceName]  # optional (or its alias `labelColumns`); instance
                                 #   identity columns, ≥1 entry when present.
                                 #   Set at most one of `instanceLabels` or
                                 #   `labelColumns`, not both. Without either,
                                 #   all rows collapse into one instance.
  valueColumn: n             # optional; numeric column carried as the alert
                             #   value, rendered in messages as ${value}
  maxInterval: 15m           # optional; duration string, ceiling for clickety-clack's
                             #   adaptive evaluation backoff before the rule is
                             #   flagged degraded. Must be >= evaluationInterval
                             #   when both parse. Defaults to the engine's own value.
  annotations:               # optional; free string map passed through to the
    team: core               #   clickety-clack rule. Keys starting with `everr.`,
                             #   and the exact keys `summary`, `description`,
                             #   `link.alert`, `link.runbook`, are reserved for
                             #   Everr's generated annotations and rejected.
```

All fields are strict — unknown keys are rejected.

## Alert Design Checklist

Before writing SQL, decide whether the condition should notify a human at all. Prefer alerts that describe a real symptom: something urgent, actionable, and active or imminent.

Do not create alert rules for interesting, weird, or purely diagnostic signals; put those in dashboards or ad hoc queries instead.

For user-facing services, start with the four golden signals:

| Signal | Prefer alerting on | Avoid |
| --- | --- | --- |
| Latency | Tail latency such as p95/p99 over a recent window, separated by success/failure when possible | Mean latency, or mixing fast failures into successful request latency |
| Traffic | Sudden drop to near-zero when traffic is expected, impossible spikes, or missing expected work | Raw high traffic unless it is causing a user-visible problem |
| Errors | Error rate with a minimum-volume guard | A single error log row or every error occurrence |
| Saturation | Resource near exhaustion, or expected to exhaust soon | Short CPU/memory blips without user impact |

Keep notification rules simple. A future reader should be able to understand why the query fires, what value crossed the threshold, and what made it stop firing.

When your human driver asks to suggest them alerts to create, give a response based on everr data (local and production) and on the telemetry defined in their codebase.

## Link a Runbook

Every alert should link a runbook that makes it actionable. Set `spec.runbook` to a runbook's slug (a bare `slug` resolves within the alert's own project; use `project/slug` to point at another project). `everr apply` fails if the linked runbook does not exist — apply the runbook in the same run or beforehand. (The legacy `spec.notebook` field is still accepted as an alias.)

The runbook should answer, for whoever the alert wakes up:

- what the alert means and why it matters,
- how to confirm it's real (the dashboards/queries to look at),
- the usual causes and how to mitigate them.

The link appears on the alert's detail page and list row, and in the Telegram and Slack notifications. See `rules/runbooks.md` for authoring.

Runbooks can also show the alert's own status by querying the alert service
events projected into `logs`. Add a small Table panel that filters
`ServiceName = 'alert'`, `LogAttributes['alert.slug'] = '<alert-slug>'`, and
the selected time range. Useful columns are
`LogAttributes['alert.event_type']`, `alert.row_count`, `alert.silenced`,
`alert.delivery_targets`, and `alert.instance_labels`.

```sql
SELECT
  TimestampTime AS event_time,
  LogAttributes['alert.event_type'] AS event_type,
  LogAttributes['alert.row_count'] AS row_count,
  LogAttributes['alert.silenced'] AS silenced,
  LogAttributes['alert.delivery_targets'] AS delivery_targets,
  LogAttributes['alert.instance_labels'] AS instance_labels
FROM logs
WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
  AND ServiceName = 'alert'
  AND LogAttributes['alert.slug'] = '<alert-slug>'
ORDER BY event_time DESC
LIMIT 50
```

Example — an AlertRule and its runbook applied together:

```yaml
# everr/db-pool-exhausted.alert.yaml
kind: AlertRule
metadata:
  name: db-pool-exhausted
  project: platform
spec:
  runbook: db-pool-runbook         # → platform/db-pool-runbook
  evaluationInterval: 1m
  notificationMessage:
    title: "DB connection pool exhausted"
  query: |
    SELECT ...
```

```yaml
# everr/db-pool-runbook.runbook.yaml
kind: Runbook
metadata:
  name: db-pool-runbook
  project: platform
spec:
  markdown:
    file: ./db-pool-runbook.runbook.md
```

## Writing Alert Queries

The query drives everything. Thresholds, grouping, and instance identity all live in the SQL.

### Thresholds

Express the condition in the query itself. Use `HAVING` for aggregates or `WHERE` for row-level filters.

```sql
-- Error-rate threshold with a minimum-volume guard
SELECT
  ServiceName,
  count() AS total,
  countIf(SeverityNumber >= 17) AS errors,
  round(errors / total, 4) AS error_rate
FROM logs
WHERE Timestamp >= now() - INTERVAL 15 MINUTE
GROUP BY ServiceName
HAVING total >= 100
  AND error_rate > 0.05
ORDER BY error_rate DESC
LIMIT 50
```

```sql
-- Row-level: reserve this shape for rare, clearly actionable events
SELECT ServiceName, TraceId, Body
FROM logs
WHERE Timestamp >= now() - INTERVAL 5 MINUTE
  AND SeverityNumber >= 21          -- FATAL
LIMIT 50
```

Prefer rates over raw counts when traffic changes meaningfully. Always add a minimum-volume guard to percentage-based alerts so one failure in one request does not fire. Filter known-benign data in SQL, such as test services, development environments, or maintenance jobs.

### Instance Identity

Each returned row becomes a firing-instance candidate, identified by its `instanceLabels` values. Set `instanceLabels` to the columns that distinguish "different things that can alert independently" (usually `ServiceName`, a cluster, an endpoint). Rows with distinct label values are independent alerts; rows that share an identity collapse into one instance. Without `instanceLabels`, all rows collapse into a single instance for the whole rule.

Pick stable identities. A column whose value changes between evaluations (a host or pod name, a sample message) fragments the identity and churns: the old instance resolves and a new one fires every time the value changes, even though the service never recovered.

```yaml
instanceLabels: [ServiceName]  # identity is exactly these columns
```

Every listed column must exist in the result set.

### Anti-flap: `for` and `resolveAfter`

`for` requires the condition to hold continuously before firing: with `for: 2m` and `evaluationInterval: 1m`, the query must match on consecutive evaluations for 2 minutes before the notification goes out. While waiting the instance is pending and sends nothing. Default `0s` fires on the first match.

`resolveAfter` is the number of consecutive empty evaluations before a firing instance resolves. Default `1`. Raise it (for example `3`) when the data source has gaps, so a single quiet evaluation does not flap the alert to resolved and back.

### `valueColumn`

Set `valueColumn` to the numeric result column that explains the alert (an error rate, a queue depth). It is carried onto each instance and rendered in notification messages as `${value}`. Omit it for purely boolean conditions.

### Evaluation Interval and Time Windows

The `evaluationInterval` controls how often the rule runs. Minimum `1m`. Align the query's time window to the interval — a 15-minute window with a 1-minute interval re-evaluates every minute over a sliding 15-minute range.

Do not use `${...}` templates in queries. Queries are plain SQL. Template variables (`${column}`) are only for `notificationMessage`.

### `maxInterval`

`maxInterval` caps clickety-clack's adaptive evaluation backoff: the longest interval the engine may widen out to before the rule is flagged degraded. Set it as a duration string (`<int><s|m|h|d>`), and keep it at or above `evaluationInterval` (apply rejects it otherwise, when both parse). Leave it unset to use the engine's default.

### `annotations`

`annotations` is a free string map merged onto the underlying clickety-clack rule alongside the annotations Everr generates for you (the notification templates, the runbook link). Use it for metadata your own tooling reads, such as a team name or a ticket link.

Keys starting with `everr.`, and the exact keys `summary`, `description`, `link.alert`, and `link.runbook`, are reserved for that generated sugar and rejected at apply time: an authored value there would otherwise be silently overwritten by the generated one.

```yaml
annotations:
  team: core
  runbook.ticket: OPS-1234
```

A rule created directly through the engine API that carries `everr.name` and a matching `everr.repoid` is treated as owned by that repo's config: the next `everr apply` adopts it, and prunes it if no YAML file declares it.

### Keep Result Sets Small

The firing set is the rows. Every returned row is tracked, fingerprinted, and potentially notified.

Use selective time windows, `GROUP BY`, and `LIMIT` to keep queries focused. Avoid `SELECT *`; return only the identity columns, measured values, and message fields needed for the alert.

## Notification Message Templates

`notificationMessage.title` and `notificationMessage.description` support `${...}` interpolation, rendered per instance:

- `${<column>}` may reference any column the query returns: an `instanceLabels` column expands to that instance's value for it, and every other column resolves from the event's evidence (the source row's non-label columns).
- `${value}` expands to the instance's `valueColumn` value and requires `valueColumn` to be set (or a result column literally named `value`).

Referencing a column the query does not return fails at apply time. Evidence is capped at 16 non-label columns and 4096 bytes of JSON per event; past the caps, non-label refs may render empty (apply warns when a message depends on columns beyond the 16-column cap).

```yaml
notificationMessage:
  title: "${ServiceName} exceeded the log volume threshold"
  description: "Emitted ${value} logs in the last window"
instanceLabels: [ServiceName]
valueColumn: n
```

## Verification

1. Test the query using `everr cloud query` and confirm the result set stays far below 1,000 rows — every returned row is a firing instance.
2. Run `everr apply ./everr --preview` and confirm the summary shows the expected creates/updates, then open the printed `Preview:` link and check the alert's firing/ok state (preview alerts evaluate but never notify).

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| `${...}` in the query | Queries are plain SQL; use `${...}` only in `notificationMessage` |
| `instanceLabels` or `valueColumn` references a missing column | Every referenced column must exist in the query result set |
| Template references a non-label column (`${n}` without `instanceLabels: [n]`) | Only `${<instanceLabel>}` and `${value}` are substituted; add the column to `instanceLabels` or expose it via `valueColumn` |
| `${value}` without `valueColumn` | Set `valueColumn` to the numeric column the alert should carry |
| `evaluationInterval` below `1m` | Use `1m` or higher |
| Query returns thousands of rows | Add `LIMIT` and tighten the `WHERE`/`HAVING` |
| Error-rate alert without a minimum-volume guard | Add `HAVING total >= <baseline>` so tiny samples do not fire |
| Alerting on mean latency | Prefer p95/p99 or another tail-latency signal |
| Template variable `${Foo}` but the label column is `foo` (case mismatch) | Match column names exactly |
| Alert flaps on gappy data | Raise `resolveAfter` (and consider `for`) instead of loosening the query |
| Notification channel enabled but no recipients | Add at least one Telegram chat ID |
| Expecting re-notification on every evaluation | Notifications fire on transitions, not every tick |
| Both `query` and `sql` set (or both `instanceLabels` and `labelColumns`) | Set exactly one of each pair, they are aliases for the same field |
| `maxInterval` shorter than `evaluationInterval` | Raise `maxInterval` to at least `evaluationInterval`, or drop it to use the default |
| `annotations` key rejected at apply time | Rename it: `everr.*` and the exact keys `summary`, `description`, `link.alert`, `link.runbook` are reserved for generated annotations |
