# HTTP API reference

The `api` role serves a JSON HTTP API. All management endpoints are under `/v1`;
health checks are at the root. Served on `CC_HTTP_ADDR` (default `0.0.0.0:8080`).

## Authentication

Two headers are involved: an optional static API key that gates access to the
API at all, and a tenant header that scopes each request.

### API key (`Authorization: Bearer`)

When the server is started with `CC_API_KEYS` set (comma-separated static keys;
see [configuration](configuration.md#http-api-authentication)), every `/v1`
endpoint requires:

```
Authorization: Bearer <key>
```

where `<key>` is any one of the configured keys (multiple keys allow
zero-downtime rotation). Comparison is constant-time across the whole list:
every configured entry is compared on every request, with no early exit, so
response timing reveals nothing about key contents or which entry matched. A
missing, malformed, or wrong key yields `401` with detail
`missing or invalid API key`. `/healthz` and `/readyz` never require a key.

When `CC_API_KEYS` is unset the gate is off (the dev default) and `/v1` is
reachable without the header. Do not run a network-reachable deployment this
way: without a key, anyone who can reach the port can assert any tenant via
`X-CC-Tenant`.

#### Tenant-bound keys (`<key>@<tenant-id>`)

A `CC_API_KEYS` entry may bind a key to one tenant:
`CC_API_KEYS=global-key, scoped-key@tenant-a` (see
[configuration](configuration.md#http-api-authentication)). Requests using a
bound key have their tenant **derived from the key**: the gate stamps
`X-CC-Tenant` with the bound tenant before any handler runs, so the caller
cannot act as a different tenant. If the caller also sends `X-CC-Tenant`, it
must equal the bound tenant; a mismatch yields `401` with detail
`API key is not authorized for the requested tenant`. Unbound (plain) entries
keep the legacy behavior below. This applies to every `/v1` endpoint.

### Tenant (`X-CC-Tenant`)

Every `/v1` endpoint is scoped to a tenant by an HTTP header:

```
X-CC-Tenant: <uuid>
```

The value must parse as a UUID; it becomes the `TenantId` for the request. The
API key authenticates the *caller* (everr's backend); this header selects the
*tenant* the caller is acting for. A missing or unparseable header yields
`401`. With an **unbound** key (or no key gate), any key holder can assert any
tenant here; a **tenant-bound** key makes this header optional and enforced
(it must match the key's tenant).

## Conventions

- Request and response bodies are JSON (`Content-Type: application/json`).
- Timestamps are RFC 3339 (e.g. `2026-06-14T12:00:00Z`).
- Enums serialize as lowercase strings: `severity` ∈ {`info`,`warning`,`critical`};
  event `status` ∈ {`firing`,`resolved`}; instance `status` ∈
  {`inactive`,`pending`,`firing`}; matcher `op` ∈ {`eq`,`ne`,`regex`,`notregex`}.
- Successful mutations return `200` with the stored object; deletes return
  `{"deleted": true}`.

## Errors

All errors use a problem-details shape:

```json
{ "type": "about:blank", "title": "<code>", "status": <int>, "detail": "<message>", "code": "<code>" }
```

| Status | `code`              | When |
| ------ | ------------------- | ---- |
| 400    | `bad_request`       | Malformed opaque input (currently: an undecodable pagination `cursor`). |
| 401    | `unauthorized`      | Missing/invalid `Authorization` bearer key when `CC_API_KEYS` is set (detail: `missing or invalid API key`), missing/invalid `X-CC-Tenant` (detail: `missing or invalid tenant`), or a tenant-bound key used with a different `X-CC-Tenant` (detail: `API key is not authorized for the requested tenant`). |
| 404    | `not_found`         | GET/DELETE of an id/name that does not exist. |
| 409    | `conflict`          | Optimistic-concurrency failure (rule `version` mismatch on `PUT /v1/rules/:id`). |
| 422    | `validation_failed` | A field failed validation (see per-endpoint notes). |
| 500    | `internal`          | Unhandled server error. |

---

## Health

| Method & path | Description |
| ------------- | ----------- |
| `GET /healthz` | Liveness. Returns `ok`. No auth. |
| `GET /readyz`  | Readiness. Returns `ok`. No auth. |

---

## Rules

A rule is a SQL query plus the metadata that turns its rows into alert instances.
See [data model → Rule](data-model.md#rule) for field semantics.

| Method & path             | Description |
| ------------------------- | ----------- |
| `POST /v1/rules`          | Create a rule. Body = identity (`name`, optional `namespace`) + rule spec (below). Returns the stored `Rule`. |
| `GET /v1/rules`           | List rules, with cursor pagination and an optional health filter (see [Listing rules](#listing-rules)). |
| `GET /v1/rules/:id`       | Get one rule by UUID. |
| `PUT /v1/rules/:id`       | Update a rule's spec in place (see below). Preserves id, tenant, `paused` and instance state; bumps `version`. |
| `DELETE /v1/rules/:id`    | Delete a rule. |
| `POST /v1/rules/:id/test` | Evaluate the supplied spec ad hoc against ClickHouse. **No state change, no events.** |
| `POST /v1/rules/:id/pause`  | Pause evaluation. Freezes state, emits no events. Returns the updated `Rule`. Idempotent; unknown id → `404`. |
| `POST /v1/rules/:id/resume` | Resume evaluation. Re-arms scheduling and restarts pending instances' for-duration. Returns the updated `Rule`. |

### Rule create (request body)

The create body is the rule's identity (`name`, optional `namespace`) with the
spec fields flattened beside it:

```json
{
  "name": "default/high-errors",
  "sql": "SELECT host, errors FROM error_rates WHERE errors > 100",
  "interval_secs": 30,
  "for_secs": 60,
  "label_columns": ["host"],
  "value_column": "errors",
  "severity": "critical",
  "annotations": { "runbook": "https://…" },
  "resolve_after": 1,
  "max_interval_secs": 3600,
  "suppressed": false
}
```

| Field           | Type                  | Required | Default | Notes |
| --------------- | --------------------- | -------- | ------- | ----- |
| `name`          | string                | yes      | —       | The rule's first-class identity, unique per `(tenant, namespace)`; `409` on conflict. 1 to 128 chars of `[A-Za-z0-9_./-]` (`422` otherwise). |
| `namespace`     | string                | no       | `""`    | Identity scope: `""` is the live namespace; consumers stamp preview ids here. At most 128 chars of `[A-Za-z0-9_.-]`. |
| `sql`           | string                | yes      | —       | Read-only `SELECT`, validated by `cc_sqlguard`. Non-SELECT is rejected `422`. |
| `interval_secs` | u32                   | yes      | —       | Must be `> 0` (`422` otherwise). Evaluation period. |
| `for_secs`      | u32                   | yes      | —       | For-duration before firing. `0` fires immediately. |
| `label_columns` | string[]              | yes      | —       | Result columns forming instance identity. |
| `value_column`  | string                | no       | null    | Numeric column carried as the instance value. |
| `severity`      | enum                  | yes      | —       | `info` \| `warning` \| `critical`. |
| `annotations`   | object<string,string> | no       | `{}`    | Free-form metadata, passed through onto events. |
| `resolve_after` | u32                   | no       | `1`     | Consecutive absent evaluations required to resolve. Must be `>= 1` (`422` otherwise). |
| `max_interval_secs` | u32 \| null       | no       | null    | Opt-in adaptive cadence: cap for the stretched evaluation interval. Must be `>= interval_secs` (`422` otherwise). While set, each quiet evaluation (no rows, nothing pending or firing) doubles the effective interval from `interval_secs` up to this cap; any active or erroring evaluation snaps it back to `interval_secs`. Null (the default) keeps the fixed cadence. Accepted by `POST /v1/rules`, `PUT /v1/rules/:id`, and `POST /v1/rules/:id/test`; returned when set. See [write alert rules](../how-to/write-alert-rules.md#max_interval_secs-adaptive-cadence). |
| `suppressed`    | bool                  | no       | `false` | Preview mode: evaluate fully and record events/history, but never notify. Accepted by `POST /v1/rules`, `PUT /v1/rules/:id`, and `POST /v1/rules/:id/test`; returned by every rule read. See [write alert rules](../how-to/write-alert-rules.md#suppressed-preview-mode). |

### Rule response

```json
{ "id": "<uuid>", "tenant": "<uuid>", "spec": { … }, "version": 1, "paused": false }
```

The response includes a `paused` boolean — an operational flag (not part of
`spec`; toggling it does not affect `version`).

### Listing rules

`GET /v1/rules` returns each rule as a **RuleView**: the `Rule` fields (above)
plus `health` (status, consecutive failures, last error) and `rollup` (the
rule's rolled-up alert state). The response is always a page envelope; with no
query parameters the default `limit` applies:

```json
{ "items": [ { "id": "…", "spec": { … }, "health": { … }, "rollup": { … } }, … ],
  "next_cursor": "djE6MTc2NTQzMj…" }
```

| Param       | Type   | Default | Notes |
| ----------- | ------ | ------- | ----- |
| `limit`     | int    | `100`   | Page size, `1..=500`. Out-of-range or non-integer values yield `422`. |
| `cursor`    | string | (none)  | Opaque resume token from the previous page's `next_cursor`. Do not construct or inspect it; its format may change. An undecodable token yields `400 bad_request`. |
| `health`    | string | (none)  | Optional filter, `degraded` or `healthy`. Anything else yields `422`. |
| `namespace` | string | (none)  | Optional exact-match filter on the identity namespace (`""` selects live rules). |
| `name`      | string | (none)  | Optional exact-match filter on the first-class `name`. |

Rules are ordered by creation time (id as tiebreaker), so the order is stable
across pages. `next_cursor` is `null` on the last page; a non-null value is
passed back verbatim as `?cursor=…` to fetch the next page. Rules created or
deleted between page fetches are handled the way keyset pagination always
handles them: no duplicates and no skipped pre-existing rows, but rows created
behind the cursor position are not revisited. (The pre-pagination bare-array
mode is gone: every response uses the envelope above.)

### Updating a rule

`PUT /v1/rules/:id` takes a **full** rule spec (same shape and validation as
`POST /v1/rules`) plus one optional top-level field:

```json
{
  "sql": "SELECT host, errors FROM error_rates WHERE errors > 200",
  "interval_secs": 30,
  "for_secs": 60,
  "label_columns": ["host"],
  "severity": "critical",
  "version": 3
}
```

| Field     | Type | Required | Notes |
| --------- | ---- | -------- | ----- |
| `version` | i64  | no       | Optimistic-concurrency guard: must equal the stored `version`, else `409 conflict` and nothing is written. Omit for last-write-wins. |

The update is in-place: the rule keeps its id, tenant and `paused` flag, and
`version` is bumped by one. Returns the stored `Rule` (like create). Unknown id
or another tenant's id yields `404`.

Spec-change side effects (all applied atomically with the update):

- **`label_columns` changed** (compared as a set; reordering is not a change):
  all existing instances for the rule are **deleted** and the rollup resets to
  `inactive`. Instance keys hash the label set, so old identities can never
  match a future evaluation; keeping them would strand pending/firing instances
  forever. No `resolved` events are emitted for the cleared instances (same
  silent teardown as `DELETE`). If `label_columns` is unchanged, instance state
  (firing/pending/inactive, for-duration clocks, dedup identity) is preserved.
- **`sql` changed**: the rule-health `consecutive_failures` counter and stored
  `last_error` are reset, so a fixed query starts from a clean slate instead of
  being one stale failure away from degrading. A `degraded` status is **not**
  silently cleared: the next successful evaluation flips it to healthy and
  emits the paired rule-health `resolved` event.
- **`interval_secs` changed**: the next evaluation is rescheduled to
  `min(current next_eval, now + jitter phase)`, where the jitter phase is the
  rule's deterministic anti-stampede offset in `[0, new interval)` (see
  [write alert rules](../how-to/write-alert-rules.md#evaluation-cadence-jitter-and-adaptive-backoff)).
  A shortened interval therefore takes effect within one new interval instead
  of waiting out the old schedule.
- **`interval_secs` or `max_interval_secs` changed**: any adaptive-cadence
  stretch is reset, so the new parameters start from the base interval.

### Test response

```json
{ "matched": 2, "rows": [ { "labels": { "host": "web-1" }, "value": 142.0 }, … ] }
```

---

## SLOs

An SLO is a `good`/`valid` SLI query plus the metadata that turns its error
budget into multi-window burn-rate alerts. See [data model → SLO](data-model.md#slo)
for field semantics and [define SLOs and burn-rate alerts](../how-to/define-slos-and-burn-rate-alerts.md)
for how to write one.

| Method & path              | Description |
| -------------------------- | ----------- |
| `POST /v1/slos`             | Create an SLO. Body = `{ "name": ..., ...spec }` (below). Returns the stored `Slo`. |
| `GET /v1/slos`               | List SLOs for the tenant. Unpaginated; bounded by tenant scale. |
| `GET /v1/slos/:id`           | Get one SLO by UUID. |
| `PUT /v1/slos/:id`           | Update an SLO's spec in place (same body as create, plus optional `version`). Preserves id, tenant, `paused`; bumps `version`. |
| `DELETE /v1/slos/:id`        | Delete an SLO. |
| `POST /v1/slos/:id/pause`    | Pause evaluation. Freezes state, emits no events. Returns the updated `Slo`. Idempotent; unknown id → `404`. |
| `POST /v1/slos/:id/resume`   | Resume evaluation. Re-arms scheduling. Returns the updated `Slo`. |
| `GET /v1/slos/:id/status`    | Read-time-enriched status snapshot (below). `404` if the SLO does not exist. |
| `POST /v1/slos/:id/test`     | Evaluate the supplied spec ad hoc against ClickHouse over its own window. **No state change, no events.** |

### SLO spec (request body)

```json
{
  "name": "checkout-availability",
  "sli": {
    "sql": "SELECT countIf(status < 500) AS good, count() AS valid FROM http_requests WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}",
    "label_columns": []
  },
  "targetPercent": 99.9,
  "timeWindow": { "duration": "30d", "isRolling": true },
  "min_valid_events": 100,
  "annotations": { "runbook": "https://…" },
  "suppressed": false
}
```

| Field              | Type                  | Required | Default | Notes |
| ------------------ | --------------------- | -------- | ------- | ----- |
| `name`             | string                | yes      | —       | Tenant-unique, 1–128 chars of `[A-Za-z0-9_.-]`. `422` otherwise. |
| `sli.sql`          | string                | yes      | —       | Read-only `SELECT` returning `good`/`valid` numeric columns; must reference both `{window_start:DateTime}` and `{window_end:DateTime}` (`422` otherwise). |
| `sli.label_columns`| string[]              | no       | `[]`    | Result columns that fan the SLO into per-group SLIs. May not start with the reserved `__cc_` prefix (`422`). |
| `targetPercent`    | f64                   | yes      | —       | Objective, e.g. `99.9`. Must be `> 0` and `< 100` (`422` otherwise). |
| `timeWindow.duration` | string             | yes      | —       | Rolling-window shorthand (`m`/`h`/`d`/`w`), capped at 366 days (`422` over the cap). |
| `timeWindow.isRolling` | bool              | no       | `true`  | v1 supports rolling only; `false` (or a non-null `timeWindow.calendar`) is rejected `422`. |
| `timeWindow.calendar` | object \| null    | no       | `null`  | Reserved for a future calendar-aligned window; must be omitted/`null` in v1. |
| `min_valid_events` | u64 \| null           | no       | `null`  | Floor on the long window's `valid` count below which no tier can fire. `null` = off. |
| `annotations`      | object<string,string> | no       | `{}`    | Free-form metadata passed through onto tier-firing events; same `summary`/`description`/`link.*` rendering as [rule annotations](../how-to/write-alert-rules.md#annotations). |
| `suppressed`       | bool                  | no       | `false` | Preview mode: evaluates fully and tracks tier state, but never notifies. See [pause vs. suppressed](../how-to/define-slos-and-burn-rate-alerts.md#pause-vs-suppressed). |

### SLO response

```json
{ "id": "<uuid>", "tenant": "<uuid>", "name": "checkout-availability", "spec": { … }, "version": 1, "paused": false }
```

Same envelope shape as a `Rule` response: `paused` is an operational flag, not
part of `spec`, and does not affect `version`.

### Updating an SLO

`PUT /v1/slos/:id` takes the full body above (same validation as create) plus
one optional top-level field, `version` (i64) — an optimistic-concurrency
guard: must equal the stored `version`, else `409 conflict` and nothing is
written. Omit for last-write-wins. `name` conflicts with another SLO in the
tenant yield `409`.

### Test response

```json
{ "matched": 1, "groups": [ { "labels": {}, "good": 998234.0, "valid": 1000000.0, "sli": 0.998234 } ] }
```

`sli` is `good / valid`, or `null` when `valid` is `0`.

### Status response

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
          { "name": "fast-burn", "long_burn_rate": 2.1, "short_burn_rate": 1.8, "long_window_valid": 210000.0 }
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

`payload.groups[*].time_to_exhaustion_secs` and `.firing_tiers` are computed at
**read time only** from the stored snapshot plus the live `slo_instances` rows
— they are never persisted. If the stored snapshot fails to deserialize into
the current shape (a legacy or corrupt row), it is returned verbatim without
this enrichment rather than erroring. `health` has the same
`status`/`degraded_since`/`last_error` shape as
[rule health](../how-to/observe-degraded-rules.md#inspect-health-via-the-api)
and reuses `CC_RULE_DEGRADE_AFTER` as its degrade threshold — SLOs have no
separate health-config knob.

---

## Alerts (instances)

| Method & path     | Description |
| ----------------- | ----------- |
| `GET /v1/alerts`  | Current alert instances for the tenant (state machine snapshot). |

Each element:

```json
{
  "key": "<instance-key>", "rule": "<uuid>", "tenant": "<uuid>",
  "status": "firing", "labels": { "host": "web-1" }, "value": 142.0,
  "active_since": "2026-06-14T12:00:00Z", "last_seen": "2026-06-14T12:03:00Z",
  "absent_count": 0
}
```

`status` ∈ {`inactive`,`pending`,`firing`}. `key` is a deterministic SHA-256 of
the rule id plus the sorted label set.

The listing is unpaginated: it returns every non-inactive instance for the
tenant in one response, bounded only by how many alerts the tenant has active.

---

## Channels

A channel is a named delivery endpoint config, unique per tenant. Channels are
the secret-bearing resource; receivers reference them by name, so one endpoint
can back any number of receivers and be rotated with a single `PUT`.

| Method & path                | Description |
| ---------------------------- | ----------- |
| `POST /v1/channels`          | Create a channel. Create-only: an existing `name` is a `409 already_exists`. |
| `PUT /v1/channels/:name`     | Create or replace the channel's `config` in place (rotation). Body = `{ "config": … }`, same validation as create. |
| `GET /v1/channels`           | List channels (secrets redacted). Unpaginated; bounded by tenant scale. |
| `GET /v1/channels/:name`     | Get one channel (secrets redacted). |
| `DELETE /v1/channels/:name`  | Delete a channel. `409` while any receiver references it. |

### Request body

```json
{ "name": "team-slack",
  "config": { "type": "slack", "url": "https://hooks.slack.com/…" } }
```

`name` must not be empty (`422`). A `webhook` config's `url` is validated
against the same SSRF rules as
[subscription webhook URLs](#subscriptions-firehose-webhooks) (`422` on
failure). Recipient-style lists must not repeat an entry: a duplicated
`email.to` address or `telegram.chat_ids` id is rejected (`422` with `detail`
naming the duplicates, e.g. `duplicate email recipients: a@x.test`). The same
address across DIFFERENT channels stays allowed. `config` is a tagged union on
`type`:

| `type`       | Fields                              | Secret field    |
| ------------ | ----------------------------------- | --------------- |
| `webhook`    | `url` (string)                      | none (not secret) |
| `slack`      | `url` (string)                      | `url`           |
| `email`      | `to` (string[])                     | none (recipients kept) |
| `telegram`   | `bot_token` (string), `chat_ids` (string[]) | `bot_token` |

### Redaction on read

`GET` responses mask secrets in `config`: `slack.url` → `"***"`,
`telegram.bot_token` → `"***"`.
`webhook.url`, `email.to`, and `telegram.chat_ids` are returned as stored.
Secrets are also [encrypted at rest](../explanation/security-model.md);
redaction is the read-API layer on top.

### Delete conflict

`DELETE /v1/channels/:name` answers `409` (with `detail` naming the referring
receivers, e.g. `channel is referenced by receivers: oncall, ops`) while any
receiver references the channel. Delete or repoint those receivers first.

---

## Receivers

A receiver is a named set of channel references. Routes reference receivers by
name; a matched receiver's notification fans out to every channel in its list.
Receiver payloads never carry secrets: `channels` is a list of channel names.

| Method & path                 | Description |
| ----------------------------- | ----------- |
| `POST /v1/receivers`          | Create a receiver. Create-only: an existing `name` is a `409 already_exists`. |
| `PUT /v1/receivers/:name`     | Create or replace the receiver's `channels`/`annotations` in place. Body = the request body below without `name`. |
| `GET /v1/receivers`           | List receivers. Unpaginated; bounded by tenant scale. |
| `GET /v1/receivers/:name`     | Get one receiver. |
| `DELETE /v1/receivers/:name`  | Delete a receiver. `409` while any route targets it. |

### Request body

```json
{ "name": "oncall",
  "channels": ["team-slack", "oncall-mail"],
  "annotations": { "team": "core", "runbook": "https://…" } }
```

`name` must not be empty (`422`). `channels` must contain at least one channel
name; an empty or missing list is rejected (`422`), every referenced name
must exist as a channel (`422` with `detail` listing the unknown names, e.g.
`unknown channels: nope-1, nope-2`), and a name must not appear more than once
(`422` with `detail` naming the duplicates, e.g. `duplicate channels: pd`). `annotations` is an optional free-form
string map (default `{}`): operator metadata such as team ownership or runbook
links. It is returned as stored on every read (never redacted) and replaced
wholesale on `PUT`; a `PUT` body that omits it resets the map to `{}`.

`DELETE /v1/receivers/:name` answers `409` (with `detail` naming the referring
route ids, e.g. `receiver is referenced by routes: 6f1c…, 91ab…`) while any
route targets the receiver. Deleting it would leave those routes pointing at
nothing and silently drop every alert they match, so delete or repoint them
first.

---

## Routes

Routes form an ordered routing tree: an event is matched against routes in
priority order; the first match (or all matches, with `continue`) selects the
receiver(s).

| Method & path           | Description |
| ----------------------- | ----------- |
| `POST /v1/routes`       | Create a route. |
| `GET /v1/routes`        | List routes (sorted: priority ascending, then creation order). Unpaginated; bounded by tenant scale. |
| `PUT /v1/routes/:id`    | Replace a route in full (same body and validation as create). Unknown id, or another tenant's route, yields `404`. Returns the updated route. |
| `DELETE /v1/routes/:id` | Delete a route by UUID. |

### Request body (create and update)

```json
{
  "matchers": [{ "label": "severity", "op": "eq", "value": "critical" }],
  "receiver": "oncall",
  "continue": false,
  "priority": 0,
  "group_by": ["rule", "severity"],
  "group_wait_secs": 10,
  "group_interval_secs": 300,
  "repeat_interval_secs": 14400
}
```

| Field                 | Type                | Required | Default | Notes |
| --------------------- | ------------------- | -------- | ------- | ----- |
| `matchers`            | Matcher[]           | yes      | —       | All must match (AND). Empty list matches everything. |
| `receiver`            | string              | yes      | —       | Receiver name. Must not be empty, and must already exist (`422` with `detail` naming it, e.g. `unknown receiver: oncall`). |
| `continue`            | bool                | no       | `false` | If true, keep evaluating later routes after this match. |
| `priority`            | i32                 | no       | `0`     | Lower is evaluated first. |
| `group_by`            | string[] \| null    | no       | null → `["rule","severity"]` | Labels that define a group. |
| `group_wait_secs`     | u32 \| null         | no       | null → `10`  | Delay before a group's first flush. |
| `group_interval_secs` | u32 \| null         | no       | null → `300` | Minimum spacing between a group's subsequent flushes. |
| `repeat_interval_secs` | u32 \| null        | no       | null → never | Re-notify a group's still-firing alerts after this long. Null never re-notifies. Must be `>= 60` when set (`422` otherwise). See [data model → Route](data-model.md#route). |

`PUT` is a full-body replace: any optional field omitted from the body resets
to its default, exactly as if the route were being created.

A **Matcher** is `{ "label": string, "op": "eq"|"ne"|"regex"|"notregex", "value": string }`.
Matchers may target user labels or the synthetic labels `severity`, `status`,
`rule`. See [data model → Matcher](data-model.md#matcher).

---

## Subscriptions (firehose webhooks)

Subscriptions are the no-routing fallback: a tenant with **no routes** delivers
every event immediately, one notification per event, to every subscription.

| Method & path                  | Description |
| ------------------------------ | ----------- |
| `POST /v1/subscriptions`       | Register a webhook URL. Body: `{ "webhook_url": "https://…" }`. |
| `GET /v1/subscriptions`        | List this tenant's subscriptions (sorted by creation time). Unpaginated; bounded by tenant scale. |
| `DELETE /v1/subscriptions/:id` | Delete a subscription by UUID. Unknown id or another tenant's id yields `404`. |

Webhook URLs are validated at create time (`422` on failure): the scheme must
be `http` or `https`, the URL must have a host and no userinfo, and the target
must not be `localhost` or an IP literal in a private, loopback, link-local, or
metadata range (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8,
169.254.0.0/16, 0.0.0.0/8, ::1, ::, fc00::/7, fe80::/10, and IPv4-mapped forms
of the blocked v4 ranges). The same rules apply to `webhook` receiver channels.
Non-IP hostnames (internal DNS, compose service names) are allowed; blocking
names that *resolve* to internal addresses is a deployment-level egress-policy
concern, since a create-time DNS check is defeated by rebinding. Set
`CC_ALLOW_PRIVATE_WEBHOOKS=1` (dev only) to allow private targets; see
[configuration](configuration.md#http-api-authentication).

Create response (list elements have the same shape):

```json
{
  "id": "<uuid>", "tenant": "<uuid>",
  "webhook_url": "https://…", "created_at": "2026-06-14T12:00:00Z"
}
```

---

## Silences

Suppress matching events (firing *and* resolved) during a time window.

| Method & path             | Description |
| ------------------------- | ----------- |
| `POST /v1/silences`       | Create a silence. |
| `GET /v1/silences`        | List silences (expired ones included until garbage-collected). Unpaginated; bounded by tenant scale. |
| `DELETE /v1/silences/:id` | Delete a silence by UUID. |

### Request body

```json
{
  "matchers": [{ "label": "host", "op": "eq", "value": "web-1" }],
  "starts_at": "2026-06-14T00:00:00Z",
  "ends_at":   "2026-06-14T01:00:00Z",
  "comment":   "maintenance",
  "author":    "you"
}
```

`matchers` required; `starts_at`/`ends_at` required RFC 3339 (`ends_at` must be
strictly after `starts_at`, else `422`); `comment`/`author` optional. A silence is
active when `starts_at <= now < ends_at`. Response adds server-set `id` and
`created_at`.

---

## Inhibitions

Suppress a *target* alert while a matching *source* alert is firing.

| Method & path                | Description |
| ---------------------------- | ----------- |
| `POST /v1/inhibitions`       | Create an inhibition rule. |
| `GET /v1/inhibitions`        | List inhibition rules. Unpaginated; bounded by tenant scale. |
| `DELETE /v1/inhibitions/:id` | Delete by UUID. |

### Request body

```json
{
  "source_matchers": [{ "label": "severity", "op": "eq", "value": "critical" }],
  "target_matchers": [{ "label": "severity", "op": "eq", "value": "warning" }],
  "equal": ["cluster"]
}
```

`source_matchers`/`target_matchers` required; `equal` (optional) is the list of
labels that must be equal between a firing source and the target for suppression
to apply. See [data model → Inhibition](data-model.md#inhibitionrule) for the
exact rule, including the self-inhibition guard.

---

## Consuming alert events

There is no HTTP event stream. Alert events are consumable two ways:

- **OTLP log export**: the `events` role consumes the Redis event stream (its
  own `cc:logexport` consumer group) and exports every event, including events
  from `suppressed` (preview) rules, as OTLP logs. Query them like any other
  logs.
- **Firehose webhooks**: for a tenant with no routes,
  [subscriptions](#subscriptions-firehose-webhooks) push every notifiable
  event to a webhook as it happens.

For point-in-time state, poll `GET /v1/alerts`.
