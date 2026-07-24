# Data model reference

The concepts you configure and the shapes the engine stores. Field names match
the JSON wire format. Defaults shown are what the server fills in when a field is
omitted.

- [Rule](#rule)
- [Instance and Status](#instance-and-status)
- [SLO](#slo)
- [SLO status snapshot](#slo-status-snapshot)
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
| `suppressed`    | bool                  | `false` | Preview mode: the rule evaluates fully and produces events and history, but the dispatcher never notifies on its events (no routing, grouping, subscriptions, silences, or inhibitions apply). The OTLP alert log still carries the events. |

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

## SLO

An error-budget objective plus its multi-window burn-rate tiers, evaluated
against a `good`/`valid` SLI query. See
[define SLOs and burn-rate alerts](../how-to/define-slos-and-burn-rate-alerts.md).

| Field              | Type                   | Default | Meaning |
| ------------------ | ---------------------- | ------- | ------- |
| `sli.sql`          | string                 | —       | Read-only `SELECT` returning `good`/`valid` numeric columns, evaluated against ClickHouse with `{window_start:DateTime}`/`{window_end:DateTime}` bound. |
| `sli.label_columns`| string[]               | `[]`    | Result columns that fan the SLO into per-group SLIs. Empty = scalar SLO. |
| `targetPercent`    | f64                    | —       | Objective percentage, `> 0` and `< 100`. |
| `timeWindow.duration` | string               | —       | Rolling-window shorthand (`m`/`h`/`d`/`w`), capped at 366 days. |
| `timeWindow.isRolling` | bool                | `true`  | v1 supports rolling windows only. |
| `timeWindow.calendar` | object \| null       | `null`  | Reserved for a future calendar-aligned window; rejected if present in v1. |
| `min_valid_events` | u64 \| null            | `null`  | Floor on the long window's `valid` count below which a tier cannot fire. `null` = off. |
| `annotations`      | object<string,string>  | `{}`    | Free-form metadata, passed through onto tier-firing events. `summary`/`description`/`link.*` render into notifications the same as [rule annotations](../how-to/write-alert-rules.md#annotations). |
| `suppressed`       | bool                   | `false` | Preview mode: the SLO evaluates fully and tracks tier state, but the dispatcher never notifies on its events. |

Stored as an `Slo`: `{ id, tenant, name, spec, version, paused }` — same
envelope shape as a `Rule`: `name` is unique per tenant, `spec` is the object
above, `version` is an optimistic-lock counter (bumped by every
`PUT /v1/slos/:id`), and `paused` is an operational flag (not part of `spec`,
does not affect `version`).

### BurnRateTier

Tiers are not stored in the spec: the engine derives them from the SLO's
`timeWindow` (see [tiers](../how-to/define-slos-and-burn-rate-alerts.md#tiers-the-canonical-three-scaled-to-your-window)).

| Field         | Type                  | Meaning |
| ------------- | --------------------- | ------- |
| `name`        | string                | Tier identity (non-empty); becomes the synthetic `slo_tier` label on tier-firing instances/events. |
| `long_window` | string                | Sustained-burn window, e.g. `1h`. Must be strictly greater than `short_window`. |
| `short_window`| string                | Anti-flap window, e.g. `5m`. |
| `burn_rate`   | f64                   | Threshold (`> 0`); a tier fires when **both** its long- and short-window burn rates strictly exceed this. |
| `severity`    | [Severity](#severity) | Severity attached to the tier's emitted events. |

**Canonical tiers**, calibrated to a 30-day budget window (windows scale
proportionally for other `timeWindow` values, thresholds unchanged):

| Tier        | `long_window` | `short_window` | `burn_rate` | `severity` |
| ----------- | -------------- | -------------- | ----------- | ---------- |
| `fast-burn` | `1h`           | `5m`           | `14.4`      | critical   |
| `slow-burn` | `6h`           | `30m`          | `6.0`       | critical   |
| `ticket`    | `3d`           | `6h`           | `1.0`       | warning    |

**Tier instance identity.** Each (group × tier) pair is tracked as its own
instance, keyed like a rule instance but with the SLO id standing in for the
rule id and an extra `slo_tier` label added to the group's own labels — so a
tier transition drives the same engine state machine (`inactive` →
`pending`/`firing` → resolved) as any rule instance, and shows up alongside
rule instances in `GET /v1/alerts`. A faster tier firing auto-inhibits its
slower siblings for the same (SLO, group) — synthesized by the dispatcher,
never stored, so it cannot be misconfigured away.

---

## SLO status snapshot

The evaluator's latest computed read for an SLO — one row per SLO, upserted on
every successful evaluation tick. Returned (enriched, see below) by
`GET /v1/slos/:id/status`.

| Field                | Type                              | Meaning |
| -------------------- | --------------------------------- | ------- |
| `window`             | string                            | The SLO's `timeWindow.duration` at the time of the snapshot. |
| `target_percent`     | f64                               | The SLO's `targetPercent` at the time of the snapshot. |
| `groups[]`           | [SloGroupStatus](#slogroupstatus)[] | One entry per distinct `label_columns` combination observed. |
| `window_computed_at` | object<string,i64>                | Per-window freshness ledger: window name (e.g. `"300s"`) → unix seconds it was last recomputed. Drives the coordinated-refresh cadence — see [evaluation cadence](../how-to/define-slos-and-burn-rate-alerts.md#evaluation-cadence). |

### SloGroupStatus

| Field               | Type                              | Meaning |
| ------------------- | --------------------------------- | ------- |
| `labels`             | object<string,string>              | This group's `label_columns` values. |
| `sli`                | f64 \| null                        | `good / valid` over the budget window. `null` at zero traffic. |
| `budget_remaining`   | f64 \| null                        | Fraction of the error budget left over the budget window; may go negative once the objective is breached. `null` at zero traffic. |
| `tiers[]`            | [SloTierStatus](#slotierstatus)[]  | One entry per tier. |

At **read time only** (`GET /v1/slos/:id/status`; never persisted), each group
also gains:

| Field                     | Type                 | Meaning |
| ------------------------- | -------------------- | ------- |
| `time_to_exhaustion_secs` | u64 \| null          | Projected seconds until budget exhaustion, from `budget_remaining` and the fastest tier's `long_burn_rate`. `null` when that burn rate is unknown or `<= 0`; `0` when the budget is already exhausted. |
| `firing_tiers[]`          | object[]             | `{ tier, status }` for this group's currently non-`inactive` tier instances (`pending` or `firing`), read live from the instance store. |

A stored payload that fails to deserialize into the current shape (legacy or
corrupt) is returned verbatim by the API, without either enrichment field,
rather than erroring.

### SloTierStatus

| Field               | Type        | Meaning |
| ------------------- | ----------- | ------- |
| `name`              | string      | Tier name, matching a `BurnRateTier.name`. |
| `long_burn_rate`     | f64 \| null | Burn rate over the tier's `long_window`. `null` at zero traffic in that window. |
| `short_burn_rate`    | f64 \| null | Burn rate over the tier's `short_window`. `null` at zero traffic in that window. |
| `long_window_valid`  | f64 \| null | The tier's long-window `valid` count — the input to `min_valid_events`'s floor. `null` on rows written before this field existed (additive, defaults to `null` on read). |

---

## Event

Emitted on a firing or resolving transition; carried on the Redis event stream.

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
| `slo`          | uuid \| null               | Set (to the SLO id) only for SLO tier-firing/resolving events; omitted from the JSON entirely when `null` (a plain rule event, or an event from a replica predating this field). Its presence drives the dispatcher's synthetic `slo` label, the SLO default `group_by`, and tier auto-inhibition — see [define SLOs and burn-rate alerts](../how-to/define-slos-and-burn-rate-alerts.md). |

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
