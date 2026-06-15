# Alerts

Alerts are defined as code: `kind: AlertRule` YAML files reconciled with `everr apply`, the same gitops flow as dashboards. The query is the condition — every row it returns is a firing instance, and an empty result means resolved.

## Prerequisites

- An `everr.yaml` manifest at the apply directory root with a stable `repoid` (UUID).
- Telemetry already flowing into Everr (traces, logs, or metrics).

The manifest is required. Apply errors without it.

```yaml
# everr.yaml
repoid: "AE89E884-0AF0-45A9-8BA1-6237A162347D"
```

Generate a stable UUID once per repository. Do not reuse repoids across unrelated repos.

## AlertRule Schema

```yaml
kind: AlertRule              # required literal
metadata:
  name: <slug>               # required; stable alert identity
  labels:                    # optional; string → string map
    team: platform
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

## Writing Alert Queries

The query drives everything. Thresholds, grouping, and instance identity all live in the SQL.

### Thresholds

Express the condition in the query itself. Use `HAVING` for aggregates or `WHERE` for row-level filters.

```sql
-- Aggregate threshold: fire when error count exceeds N
SELECT ServiceName, count() AS n
FROM logs
WHERE TimestampTime >= now() - INTERVAL 15 MINUTE
  AND SeverityText = 'ERROR'
GROUP BY ServiceName
HAVING n > 10
ORDER BY n DESC
LIMIT 50
```

```sql
-- Row-level: fire when any row matches
SELECT ServiceName, TraceId, Body
FROM logs
WHERE TimestampTime >= now() - INTERVAL 5 MINUTE
  AND SeverityText = 'FATAL'
LIMIT 50
```

### Instance Identity

Each returned row becomes a firing instance. By default, Everr infers identity from all string-typed columns the query returns. A query returning `ServiceName` (string) and `n` (UInt64) produces one instance per distinct `ServiceName` value.

Use `instanceLabels` when the inferred set is wrong:

```yaml
instanceLabels: [ServiceName, route]  # identity = these columns only
```

Match `instanceLabels` to the query's `GROUP BY`. Every listed column must exist in the result set.

### Evaluation Interval and Time Windows

The `evaluationInterval` controls how often the rule runs. Minimum `1m`. Align the query's time window to the interval — a 15-minute window with a 1-minute interval re-evaluates every minute over a sliding 15-minute range.

Do not use `${...}` templates in queries. Queries are plain SQL. Template variables (`${column}`) are only for `notificationMessage`.

### Keep Result Sets Small

The firing set is the rows. Every returned row is tracked, fingerprinted, and potentially notified. 

Use `GROUP BY` and `LIMIT` to keep queries focused.

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
| Missing `everr.yaml` manifest | Add `repoid: "<uuid>"` at the apply directory root |
| Empty `repoid` or reusing across repos | Generate a stable UUID per repository |
| `${...}` in the query | Queries are plain SQL; use `${...}` only in `notificationMessage` |
| `instanceLabels` references a missing column | Every label must exist in the query result set |
| `evaluationInterval` below `1m` | Use `1m` or higher |
| Query returns thousands of rows | Add `LIMIT` and tighten the `WHERE`/`HAVING` |
| Template variable `${Foo}` but query returns `foo` (case mismatch) | Match column names exactly |
| Notification channel enabled but no recipients | Add at least one email address or Telegram chat ID |
| Expecting re-notification on every evaluation | Notifications fire on transitions, not every tick |
