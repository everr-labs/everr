# Alerts

Alerts are defined as code: `kind: AlertRule` YAML files reconciled with `everr apply`, the same gitops flow as dashboards. The query is the condition — every row it returns is a firing instance, and an empty result means resolved.

## Prerequisites

- An `everr.yaml` manifest at the apply directory root with a stable `repoid`.
- Telemetry already flowing into Everr (traces, logs, or metrics).

The manifest is required. Apply errors without it.

```yaml
# everr.yaml
repoid: "AE89E884-0AF0-45A9-8BA1-6237A162347D"
```

Use one stable id per repository. A UUID is a good default for new repositories; do not reuse repoids across unrelated repos.

## AlertRule Schema

```yaml
kind: AlertRule              # required literal
metadata:
  name: <slug>               # required; stable alert identity
spec:
  display:                   # optional
    name: <human name>
    description: <text>
  evaluationInterval: 5m     # required; format: <int><s|m|h|d>, minimum 1m
  notificationMessage:
    title: "${ServiceName} is failing"  # required; supports ${column} templates
    description: "${n} errors in the last window"  # optional; supports ${column}
  query: |                   # required; ClickHouse SQL, no ${...} templating
    SELECT ...
  instanceLabels: [col]      # optional override; ≥1 entry when present
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

Each returned row becomes a firing instance. By default, Everr infers identity from all string-typed columns the query returns. A query returning `ServiceName` (string) and `n` (UInt64) produces one instance per distinct `ServiceName` value.

Override with `instanceLabels` when the inferred set is wrong — most often when the query returns a string column you want in the message but not in the identity. A string whose value changes between evaluations (a host or pod name, a sample message) would otherwise fragment the identity and churn: the old instance resolves and a new one fires every time the value changes, even though the service never recovered.

```yaml
instanceLabels: [ServiceName]  # identity is exactly these columns; other strings ride along for the message
```

Every listed column must exist in the result set, and the query must return a single row per identity — rows that share an identity collapse into one instance.

### Evaluation Interval and Time Windows

The `evaluationInterval` controls how often the rule runs. Minimum `1m`. Align the query's time window to the interval — a 15-minute window with a 1-minute interval re-evaluates every minute over a sliding 15-minute range.

Do not use `${...}` templates in queries. Queries are plain SQL. Template variables (`${column}`) are only for `notificationMessage`.

### Keep Result Sets Small

The firing set is the rows. Every returned row is tracked, fingerprinted, and potentially notified.

Use selective time windows, `GROUP BY`, and `LIMIT` to keep queries focused. Avoid `SELECT *`; return only the identity columns, measured values, and message fields needed for the alert.

## Notification Message Templates

`notificationMessage.title` and `notificationMessage.description` support `${column}` interpolation. Each template variable must reference a column the query returns.

```yaml
notificationMessage:
  title: "${ServiceName} exceeded the log volume threshold"
  description: "Emitted ${n} logs in the last window"
```

Per-instance values come from that instance's firing row. If the query returns `ServiceName` and `count() AS n`, the template renders with the values from the row that produced the instance.

## Verification

1. Test the query using `everr cloud query`
2. Run `everr apply <dir> --dry-run` and confirm the plan shows the expected creates/updates.

## Deploying alerts in production

Only when the user is satisfied with the changes, to deploy them run:

```sh
everr apply ./definitions --yes
```

Apply discovers all `.yaml`/`.yml` files under the directory, classifies them by `kind`, and reconciles creates, updates, and deletes. Alerts not in the directory are soft-deleted (history is preserved).

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Missing `everr.yaml` manifest | Add `repoid: "<stable-repository-id>"` at the apply directory root |
| Empty `repoid` or reusing across repos | Use one stable id per repository; a UUID is a good default for new repos |
| `${...}` in the query | Queries are plain SQL; use `${...}` only in `notificationMessage` |
| `instanceLabels` references a missing column | Every label must exist in the query result set |
| `evaluationInterval` below `1m` | Use `1m` or higher |
| Query returns thousands of rows | Add `LIMIT` and tighten the `WHERE`/`HAVING` |
| Error-rate alert without a minimum-volume guard | Add `HAVING total >= <baseline>` so tiny samples do not fire |
| Alerting on mean latency | Prefer p95/p99 or another tail-latency signal |
| Template variable `${Foo}` but query returns `foo` (case mismatch) | Match column names exactly |
| Notification channel enabled but no recipients | Add at least one email address or Telegram chat ID |
| Expecting re-notification on every evaluation | Notifications fire on transitions, not every tick |
