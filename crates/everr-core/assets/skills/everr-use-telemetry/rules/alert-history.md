# Alert History (`alert_events`)

> Maintainers: this file mirrors the Reference section of the alerting
> ClickHouse surface design doc
> (`todo/issues/alerting-surface/02-alerting-clickhouse-surface.md`).
> The two move in lockstep: a column added, renamed, or re-explained in one
> is changed in the other in the same commit.

Alert history is cloud only. `everr cloud query` reads it; `everr local query`
has no such table, because alerting does not run locally.

One row per thing that happened to an alert: an evaluation, a state
transition, a withheld notification, a delivery attempt. All event types live
in one table, discriminated by `event_type`, so one query reads a whole
incident in timestamp order with no join.

## Query Rules

1. **Filter `is_live`** in every query that selects by predicate. Preview
   alerts write to the same table. Drop the predicate only when the question
   is about a preview, or on a point lookup by `notification_event_id`: the
   id already pins one chain, live or preview, and the filter would hide a
   preview chain you asked for by id.
2. **Always carry a `LIMIT`.** The cloud profile throws at 1000 result rows,
   so a query without a limit fails instead of truncating.
3. **Never filter `tenant_id`.** A row policy already scopes every read to
   your organization. Adding the predicate cannot widen a result, and getting
   the value wrong empties it.
4. **Always carry a time bound.** `event_time` is the partition key's time
   dimension, so a bound on it prunes whole months of data.
5. `silenced`, `inhibited`, `silence_id` and `silence_comment` are decided
   after the transition is written, so they carry meaning **only on
   `notification_deferred` and `notification_suppressed` rows**.
   `WHERE event_type = 'instance_fired' AND silenced` returns nothing, however
   many alerts were silenced.
6. **An absent row means unknown, not "it did not happen".** History writes
   are best effort and delivery reconciliation does not exist yet, so a
   missing delivery row is equally consistent with a lost write and a
   notification that never went out. Say which of the two you cannot tell
   apart rather than reporting the stronger claim.

## Event Types

| `event_type` | Meaning |
| --- | --- |
| `evaluation_succeeded` | The rule query ran. One row per rule per interval, so these outnumber everything else by roughly 100 to 1 |
| `evaluation_failed` | The rule query threw. `error` holds the reason |
| `instance_pending` | An instance started breaching but is inside its `for` window |
| `instance_fired` | An instance started alerting |
| `instance_resolved` | The condition cleared |
| `instance_closed` | The instance stopped for a reason other than clearing: pending cleared, rule paused, rule deleted, preview deleted. `reason` says which |
| `notification_deferred` | A silence or an inhibition held the notification; it goes out later |
| `notification_suppressed` | The notification was withheld for good |
| `delivery_succeeded` | A channel accepted the notification |
| `delivery_failed` | One send attempt failed. `error` holds the sanitized reason |

Not every type has a writer yet: `instance_pending`, `instance_closed` and
`notification_deferred` are part of the shape but nothing writes them today,
so queries about pending instances or held notifications return nothing.

## Columns

| Column | Type | Notes |
| --- | --- | --- |
| `event_id` | `UUID` | Unique per row. UUIDv7 on transition, evaluation and hold rows, so `UUIDv7ToDateTime(event_id)` recovers its creation time. Delivery rows and terminal `notification_suppressed` rows are the exceptions: their ids are deterministic so retries and repair converge, and they carry no embedded time |
| `notification_event_id` | `UUID` | Links a transition to the suppression and delivery rows that follow it. A transition sets it to its own `event_id`. Zero on evaluation rows. UUIDv7, so its embedded time is the chain start |
| `episode_id` | `UUID` | The opening event's id: one continuous breach, from leaving inactive to resolved or closed. Set on `instance_pending`, `instance_fired`, `instance_resolved` and `instance_closed`; zero elsewhere. `GROUP BY episode_id` reads an incident whole |
| `tenant_id` | `LowCardinality(String)` | Enforced by row policy. Never filter on it |
| `alert_definition_id` | `UUID` | The rule's id |
| `repoid`, `slug` | `LowCardinality(String)` | Sort key prefix: filtering on both is significantly faster. `slug` alone merges same-named rules across repositories |
| `preview_id` | `UUID` | Zero UUID means live |
| `is_live` | `Bool` | True when `preview_id` is zero. Filter on this, never on the zero sentinel |
| `event_type` | `LowCardinality(String)` | See the table above. Second partition dimension: evaluation rows sit in their own partitions, so every non-evaluation query skips them whole |
| `write_source` | `LowCardinality(String)` | `'live'` or `'reconciled'` |
| `evaluation_scheduled_at`, `event_time` | `DateTime64(3)` | `event_time` is when it happened, and the column every query bounds. `evaluation_scheduled_at` is when the evaluation was due; it is the epoch (1970) off evaluation rows, so never `dateDiff` against it there. Delivery `event_time` is send time, not evaluation time |
| `row_count` | `UInt64` | Rows the rule query returned |
| `evidence_json`, `samples_json` | `String` | Opaque JSON: the query-wide evidence and the captured sample rows |
| `evidence_truncated`, `samples_truncated` | `Bool` | Set when the JSON beside them was cut short |
| `error` | `String` | Set on `evaluation_failed` and `delivery_failed`. Sanitized: never a URL or a token |
| `instance_fingerprint` | `String` | Stable identity of one alerting instance |
| `instance_labels` | `Map(LowCardinality(String), String)` | Read a key with `instance_labels['service']` |
| `service_name` | `LowCardinality(String)` | The service the alert concerns, resolved when the row was written; `'alert'` when none |
| `severity` | `LowCardinality(String)` | `info`, `warning` or `critical`. The rule's severity at write time: editing a rule changes later rows, not past ones |
| `rule_muted` | `Bool` | The rule never notifies at all (`spec.suppressed`, or a preview). Set on every row. Unrelated to `silenced`, which is about one notification |
| `reason` | `LowCardinality(String)` | `condition_cleared` on `instance_resolved`; `pending_cleared`, `rule_paused`, `rule_deleted` or `preview_deleted` on `instance_closed`; the matching value on a terminal `notification_suppressed` |
| `silenced`, `inhibited` | `Bool` | Frozen when the notification was decided. Meaningful only on `notification_deferred` and `notification_suppressed` rows; always false on a transition |
| `silence_id` | `UUID` | The matched silence, zero if none |
| `silence_comment`, `silence_matchers_json` | `String` | Copied from the silence, so the row explains itself |
| `inhibition_comment`, `inhibition_source_json` | `String` | Reserved for inhibitions, which have no writer yet; always empty today |
| `context_json` | `String` | Opaque JSON frozen on lifecycle rows, keys `{summary, description, links: {runbook, alert}, condition}`. `condition` is what makes "at what value" readable; `links` is the pivot to the runbook and the alert page |
| `delivery_targets` | `Map(String, Array(String))` | Channel type to channel name. Never an address. A channel whose config failed to decrypt is recorded under type `unknown` |
| `delivery_dedup_key` | `String` | The delivery key. Empty off delivery rows |

## Worked Queries

What fired in the last day. `notification_event_id` is selected so the chain
query below is reachable from this result:

```sql
SELECT event_time, slug, instance_fingerprint, severity, instance_labels,
       notification_event_id
FROM alert_events
WHERE event_type = 'instance_fired'
  AND is_live
  AND event_time >= now() - INTERVAL 1 DAY
ORDER BY event_time DESC
LIMIT 100
```

How long each incident ran and how it ended. `episode_id` groups one
continuous breach, so duration needs no self-join:

```sql
SELECT episode_id, any(slug) AS slug,
       min(event_time) AS opened_at,
       dateDiff('minute', min(event_time), max(event_time)) AS duration_minutes,
       argMax(event_type, (event_time, event_id)) AS last_event_type,
       argMax(reason, (event_time, event_id)) AS last_reason
FROM alert_events
WHERE event_type IN ('instance_pending', 'instance_fired',
                     'instance_resolved', 'instance_closed')
  AND is_live
  AND event_time >= now() - INTERVAL 7 DAY
GROUP BY episode_id
ORDER BY opened_at DESC
LIMIT 100
```

Every row for one notification: the transition, what was decided about it,
and every delivery attempt. The time bound is not optional, and it is
derived, never guessed: `notification_event_id` is UUIDv7, so
`UUIDv7ToDateTime` reads the chain's start out of the id, minus a day of
slack for clock skew. Without it the query scans every partition in the
retention range. Read the sequence from `event_type`, never from id order:
chain rows come from different jobs on different hosts, and the trailing
`event_id` only makes ties stable. Substitute the same id in both places:

```sql
SELECT event_time, event_type, silenced, inhibited, silence_id,
       delivery_targets, error
FROM alert_events
WHERE notification_event_id = toUUID('...')
  AND event_time >= UUIDv7ToDateTime(toUUID('...')) - INTERVAL 1 DAY
ORDER BY event_time, event_id
LIMIT 100
```

Withheld and held notifications for one alert. `silence_comment` is on the
row, so nothing has to resolve the id. Deferrals have no writer yet, so today
only `notification_suppressed` rows appear:

```sql
SELECT event_time, event_type, instance_fingerprint,
       silenced, inhibited, silence_id, silence_comment
FROM alert_events
WHERE repoid = '...' AND slug = 'default/high-5xx'
  AND event_type IN ('notification_suppressed', 'notification_deferred')
  AND is_live
  AND event_time >= now() - INTERVAL 7 DAY
ORDER BY event_time DESC
LIMIT 100
```

Delivery outcomes by channel type:

```sql
SELECT arrayJoin(mapKeys(delivery_targets)) AS channel_type,
       countIf(event_type = 'delivery_succeeded') AS sent,
       countIf(event_type = 'delivery_failed') AS failed
FROM alert_events
WHERE event_type IN ('delivery_succeeded', 'delivery_failed')
  AND is_live
  AND event_time >= now() - INTERVAL 7 DAY
GROUP BY channel_type
LIMIT 100
```

Rules failing to evaluate. Group by `repoid` and `slug` together, because
`slug` alone merges same-named rules across repositories:

```sql
SELECT repoid, slug, count() AS failures,
       max(event_time) AS last_failure, any(error) AS example
FROM alert_events
WHERE event_type = 'evaluation_failed'
  AND is_live
  AND event_time >= now() - INTERVAL 1 DAY
GROUP BY repoid, slug
ORDER BY failures DESC
LIMIT 100
```

Critical alerts with no successful delivery. Read the result with rule 6:
until delivery reconciliation exists, a lost history write and a broken
delivery look the same. `NOT rule_muted` excludes rules that never notify by
design. The 15 minute maturity offset keeps fires still inside the
group-flush wait from showing as undelivered. `held` separates two stories: a
held notification was withheld by a silence or an inhibition, which is not a
delivery incident. One scan and a `HAVING` keep the query correct under any
session setting:

```sql
SELECT notification_event_id,
       anyIf(event_time, event_type = 'instance_fired') AS fired_at,
       anyIf(slug, event_type = 'instance_fired') AS slug,
       anyIf(instance_fingerprint,
             event_type = 'instance_fired') AS instance_fingerprint,
       countIf(event_type IN ('notification_suppressed',
                              'notification_deferred')) > 0 AS held
FROM alert_events
WHERE event_time >= now() - INTERVAL 7 DAY
  AND is_live
  AND event_type IN ('instance_fired', 'delivery_succeeded',
                     'notification_suppressed', 'notification_deferred')
GROUP BY notification_event_id
HAVING countIf(event_type = 'instance_fired'
               AND severity = 'critical'
               AND NOT rule_muted
               AND event_time <= now() - INTERVAL 15 MINUTE) > 0
   AND countIf(event_type = 'delivery_succeeded') = 0
ORDER BY fired_at DESC
LIMIT 100
```
