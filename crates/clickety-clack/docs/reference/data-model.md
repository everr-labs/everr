# Data model reference

The concepts you configure and the shapes the engine stores. Field names match
the JSON wire format. Defaults shown are what the server fills in when a field is
omitted.

- [Rule](#rule)
- [Instance and Status](#instance-and-status)
- [Event](#event)
- [Matcher](#matcher)
- [Channel and ChannelConfig](#channel-and-channelconfig)
- [Receiver](#receiver)
- [Route](#route)
- [Subscription](#subscription)
- [Silence](#silence)
- [InhibitionRule](#inhibitionrule)
- [Severity](#severity)

---

## Rule

The definition of an alert.

| Field           | Type                  | Default | Meaning |
| --------------- | --------------------- | ------- | ------- |
| `sql`           | string                | —       | Read-only `SELECT` evaluated against ClickHouse. |
| `interval_secs` | u32                   | —       | Evaluation period in seconds (`> 0`). |
| `for_secs`      | u32                   | —       | "For duration": the condition must hold this long before firing. `0` = fire immediately. |
| `label_columns` | string[]              | —       | Result columns that identify an instance. |
| `value_column`  | string \| null        | null    | Numeric column carried as the value. |
| `severity`      | [Severity](#severity) | —       | Severity attached to emitted events. |
| `annotations`   | object<string,string> | `{}`    | Free-form metadata, passed through to events. The keys `summary`, `description`, `link.alert`, and `link.runbook` are also rendered into notifications (see [rule annotations](../how-to/write-alert-rules.md#annotations)). |
| `resolve_after` | u32                   | `1`     | Consecutive *absent* evaluations needed to resolve. Absorbs flaps. |
| `suppressed`    | bool                  | `false` | Preview mode: the rule evaluates fully and produces events and history, but the dispatcher never notifies on its events (no routing, grouping, subscriptions, silences, or inhibitions apply). SSE and the OTLP alert log still carry the events. |

Stored as a `Rule`: `{ id, tenant, spec, version, paused }` where `spec` is the
object above, `version` is an optimistic-lock counter (bumped by every
`PUT /v1/rules/:id` and usable as its concurrency guard), and `paused` is an
operational flag (not part of `spec`, does not affect `version`).

**Instance identity.** For each result row, the values of `label_columns` form
the labels; the labels plus the rule id are hashed (SHA-256, sorted) into a stable
`InstanceKey`. The same row content always maps to the same instance, across
processes and across evaluations.

---

## Instance and Status

An instance is one tracked alerting subject (one `label_columns` combination for
one rule). Returned by `GET /v1/alerts`.

| Field          | Type                  | Meaning |
| -------------- | --------------------- | ------- |
| `key`          | string                | Deterministic instance identity. |
| `rule`         | uuid                  | Owning rule. |
| `tenant`       | uuid                  | Owning tenant. |
| `status`       | [Status](#status)     | Current state-machine state. |
| `labels`       | object<string,string> | Labels from the result row. |
| `value`        | f64 \| null           | Value from `value_column`. |
| `active_since` | datetime \| null      | When the condition first became true (set on inactive→pending). |
| `last_seen`    | datetime              | Last evaluation in which the row was present. |
| `absent_count` | u32                   | Consecutive evaluations with no matching row. |

### Status

| Value      | Meaning |
| ---------- | ------- |
| `inactive` | Never fired, or resolved. |
| `pending`  | Condition met, but the for-duration has not elapsed yet. |
| `firing`   | Condition met for at least the for-duration; alert is active. |

The transition rules are in [the evaluation model](../explanation/evaluation-model.md).

---

## Event

Emitted on a firing or resolving transition; carried on the Redis event stream and
the SSE firehose.

| Field          | Type                       | Meaning |
| -------------- | -------------------------- | ------- |
| `tenant`       | uuid                       | Owning tenant. |
| `rule`         | uuid                       | Source rule. |
| `instance_key` | string                     | Source instance. |
| `status`       | `firing` \| `resolved`     | Transition type. |
| `labels`       | object<string,string>      | Instance labels at transition time. |
| `value`        | f64 \| null                | Instance value. |
| `severity`     | [Severity](#severity)      | From the rule spec. |
| `annotations`  | object<string,string>      | From the rule spec. Channel renderers honor `summary`, `description` (with `${key}` substitution resolving labels, then `${value}`, then evidence columns), and `link.alert` / `link.runbook`. |
| `eval_ts`      | datetime                   | When the transition occurred. |
| `suppressed`   | bool                       | Mirrors the rule's `suppressed` flag at emit time. Default `false`; older payloads without the field deserialize as `false`. The dispatcher drops suppressed events before any notification processing. |
| `evidence`     | object<string,json> \| null | Source-row context for the instance: the row's columns excluding `label_columns` (the value column is included). Capped at 16 columns and 4096 bytes of compact JSON; over the byte cap it becomes `null` with `evidence_truncated: true`. `null` for resolved-by-absence and rule-health events. |
| `evidence_truncated` | bool                 | `true` when evidence was cut to the column cap or dropped for the byte cap. Default `false`. |

---

## Matcher

The shared label-matching primitive used by routes, silences, and inhibitions.

```json
{ "label": "severity", "op": "eq", "value": "critical" }
```

| `op`       | Matches when… |
| ---------- | ------------- |
| `eq`       | the label value equals `value`. |
| `ne`       | the label value does **not** equal `value`. |
| `regex`    | the value fully matches the anchored pattern `^(?:value)$`. An invalid pattern never matches. |
| `notregex` | the value does **not** fully match the pattern. |

Rules of matching:

- A **missing** label is treated as the empty string. So `severity ne critical`
  is *true* for an event with no `severity` label.
- A list of matchers is combined with **AND** — all must match.
- An **empty** matcher list matches **everything**.

Matchers can target real labels or the **synthetic labels** the dispatcher injects
on every event: `severity`, `status` (`firing`/`resolved`), and `rule` (the rule
UUID as a string). Synthetic labels take precedence if a user label collides.

---

## Channel and ChannelConfig

A named, reusable delivery endpoint. `name` is unique per tenant; `config` is
the endpoint's tagged config. Channels are the secret-bearing resource:
receivers reference them by name and never carry configs themselves.

```json
{ "id": "<uuid>", "tenant": "<uuid>", "name": "team-slack",
  "config": { "type": "slack", "url": "https://hooks.slack.com/…" } }
```

`config` is tagged on `type`:

| `type`      | Fields                | Delivery target | Secret? |
| ----------- | --------------------- | --------------- | ------- |
| `webhook`   | `url`: string         | the URL         | no |
| `slack`     | `url`: string         | the URL         | **yes** — redacted on read, encrypted at rest |
| `pagerduty` | `routing_key`: string | the routing key | **yes** — redacted on read, encrypted at rest |
| `email`     | `to`: string[]        | the recipients (comma-joined) | no (recipients are not treated as secret) |
| `telegram`  | `bot_token`: string, `chat_ids`: string[] | bot token + chats | **yes** (`bot_token`): redacted on read, encrypted at rest |

Upserting a channel by name replaces its config in place (secret rotation);
deleting one is refused with a `409` while any receiver references it.

## Receiver

A named set of channel references. `channels` is a list of channel NAMES,
always non-empty and validated against the tenant's channels at the API
boundary. Receiver payloads carry no secrets.

```json
{ "id": "<uuid>", "tenant": "<uuid>", "name": "oncall",
  "channels": ["team-slack", "oncall-mail"],
  "annotations": { "team": "core", "runbook": "https://…" } }
```

`annotations` is a free-form string map (default `{}`) for operator metadata:
team ownership, escalation notes, dashboard links. It is not secret, is never
redacted, and is replaced wholesale on every upsert (an upsert without
`annotations` resets it to `{}`). Rows and payloads written before the field
existed read as `{}`.

Receivers are referenced by `name` from routes; the reference is resolved at
delivery time, not at route-creation time, and the receiver's channel names are
resolved to their configs at delivery time too. Grouping stays keyed by
receiver name; one group flush fans out to every channel of the receiver, each
channel with its own dedup key (keyed by the channel name, stable across config
edits) and its own notification-ledger row.

---

## Route

A node in the ordered routing tree.

| Field                 | Type             | Default                      | Meaning |
| --------------------- | ---------------- | ---------------------------- | ------- |
| `matchers`            | Matcher[]        | —                            | All must match for the route to apply. |
| `receiver`            | string           | —                            | Receiver name. |
| `continue`            | bool             | `false`                      | Keep matching later routes after this one. |
| `priority`            | i32              | `0`                          | Lower evaluated first. |
| `group_by`            | string[] \| null | null → `["rule","severity"]` | Labels that define a notification group. |
| `group_wait_secs`     | u32 \| null      | null → `10`                  | Delay before a group's first flush. |
| `group_interval_secs` | u32 \| null      | null → `300`                 | Minimum spacing between a group's later flushes. |
| `repeat_interval_secs` | u32 \| null     | null → never                 | Re-notify a group's still-firing alerts after this long. Null (the default) never re-notifies. Minimum 60 when set. |

Stored with `id` and `tenant`. The JSON key `continue` maps to the internal field
`continue_matching`.

**Repeat semantics.** After a group notification is sent, if the group still has
firing alerts and `repeat_interval_secs` has elapsed since the last send, the
dispatcher re-sends a notification carrying the still-firing set. Reminders go
through the normal channel renderers and honor silences and inhibitions active
at send time (a suppressed reminder is skipped, not cancelled: the next one is
still scheduled). A group whose alerts have all resolved never repeats. Each
reminder is a distinct notification in the dedup ledger, so it is never
collapsed with the original send.

**Selection.** Routes are evaluated in order (priority ascending, then creation
order). The first matching route's receiver is selected; with `continue=true`,
evaluation proceeds to later routes too. Duplicate receivers are de-duplicated,
keeping the **first** match's grouping parameters.

---

## Subscription

The no-routes firehose destination.

```json
{ "id": "<uuid>", "tenant": "<uuid>", "webhook_url": "https://…", "created_at": "<rfc3339>" }
```

When a tenant has no routes, every event is delivered immediately (one
notification per event) to all of that tenant's subscriptions.

---

## Silence

A time-boxed suppression.

| Field        | Type      | Default | Meaning |
| ------------ | --------- | ------- | ------- |
| `matchers`   | Matcher[] | —       | Event must match all (AND). Empty = match everything. |
| `starts_at`  | datetime  | —       | Window start (inclusive). |
| `ends_at`    | datetime  | —       | Window end (exclusive). Must be after `starts_at`. |
| `comment`    | string    | `""`    | Free text. |
| `author`     | string    | `""`    | Free text. |
| `created_at` | datetime  | server  | Set on create. |

Active when `starts_at <= now < ends_at`. An active, matching silence drops the
event — **both firing and resolved**. Expired silences are garbage-collected ~24h
after `ends_at`.

---

## InhibitionRule

Suppress a target alert while a related source alert is firing.

| Field             | Type      | Default | Meaning |
| ----------------- | --------- | ------- | ------- |
| `source_matchers` | Matcher[] | —       | Identifies the *source* (the alert that does the inhibiting). |
| `target_matchers` | Matcher[] | —       | Identifies the *target* (the alert to suppress). |
| `equal`           | string[]  | `[]`    | Labels that must be equal between a firing source and the target. |
| `created_at`      | datetime  | server  | Set on create. |

An event is **inhibited** when all of the following hold:

1. Its labels match `target_matchers`, **and**
2. some **firing** instance (a different instance — the self-inhibition guard
   excludes the event's own instance) matches `source_matchers`, **and**
3. that source agrees with the target on every label listed in `equal` (a label
   missing on either side means no inhibition), **and**
4. the event itself does **not** match `source_matchers` (a source alert can't be
   inhibited).

Inhibition is status-agnostic in matching (it uses the synthetic-label namespace,
so `severity`/`status`/`rule` are matchable) but is gated on a firing source.

---

## Severity

`info` | `warning` | `critical`. Serialized lowercase. Available as the synthetic
`severity` label for matching.
