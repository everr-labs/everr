# How to configure receivers and routing

Delivery has three layers: **channels** (named endpoint configs: Slack, email,
webhook, Telegram), **receivers** (named sets of channel references),
and **routes** (which alerts go to which receivers, and how they are grouped).
This guide covers all three, plus the no-routes subscription firehose.

For exact field shapes see [data model](../reference/data-model.md) and
[API reference](../reference/http-api.md).

## 1. Create channels

A channel is a named endpoint config, unique per tenant. Channels are the
secret-bearing resource: the Slack hook, the Telegram bot token, the webhook
URL live here and nowhere else. Any number of receivers can reference the same
channel, and `PUT /v1/channels/:name` replaces its config in place (`POST` is
create-only and returns `409` for an existing name), so rotating a secret is
one call and every referencing receiver picks it up. Names are labels: passing
a different `name` in the PUT body renames the channel, and because receivers
(and routes, for receiver renames) reference by id, nothing downstream breaks.

### Webhook

```bash
curl -s -X POST localhost:8080/v1/channels -H "X-CC-Tenant: $TENANT" \
  -H 'Content-Type: application/json' \
  -d '{ "name": "oncall-hook",
        "config": { "type": "webhook", "url": "https://example/hook" } }'
```

The dispatcher POSTs `{ "group_key": …, "events": [ … ] }` to the URL.

### Slack

```bash
-d '{ "name": "team-slack",
      "config": { "type": "slack", "url": "https://hooks.slack.com/services/…" } }'
```

Renders an incoming-webhook message: a header line (`:rotating_light: [FIRING]
critical: <headline>`, or `[N alerts] <group_key>` for a batch) plus one
color-coded attachment per event (red firing, green resolved) with the labels,
severity, and instance as fields. The headline is the rule's substituted
`summary` annotation when set (the instance key otherwise); a `description`
annotation becomes the attachment text and `link.alert` / `link.runbook` become
"View alert" / "View runbook" buttons. See
[rule annotations](write-alert-rules.md#annotations).

### Email

Requires SMTP configured on the dispatcher (`CC_SMTP_HOST`, …; see
[configuration](../reference/configuration.md#email-smtp--optional)).

```bash
-d '{ "name": "ops-mail", "config": { "type": "email", "to": ["ops@example.com"] } }'
```

### Secrets

`webhook.url`, `slack.url`, and `telegram.bot_token` are secrets: they
are [encrypted at rest](manage-secret-encryption.md) and **redacted to `***` on
read**. `GET /v1/channels` is safe to expose; it never returns the cleartext
secret. Receivers never carry secrets at all (they hold channel names only).

### Deleting channels

A channel that is still referenced by a receiver cannot be deleted:
`DELETE /v1/channels/:name` answers `409` with the referring receiver names.
Drop or repoint those receivers first.

## 2. Create receivers

A receiver is a named set of channel references. A notification for the
receiver fans out to every channel in the list, so one receiver can post to
Slack and hit a webhook at once; a single-destination receiver is just a
one-element list. Every referenced name must exist as a channel (`422` naming
the unknown ones otherwise).

```bash
curl -s -X POST localhost:8080/v1/receivers -H "X-CC-Tenant: $TENANT" \
  -H 'Content-Type: application/json' \
  -d '{ "name": "oncall", "channels": ["oncall-hook", "team-slack"] }'
```

### Annotations

Any receiver can carry a free-form `annotations` string map: who owns the
receiver, where the rota lives, which dashboard to open first.

```bash
-d '{ "name": "oncall",
      "channels": ["oncall-hook", "team-slack"],
      "annotations": { "team": "core", "rota": "https://rota.example" } }'
```

Annotations are returned as stored on every read (they are metadata, not
secrets) and are replaced wholesale on each update: `PUT` a receiver without
`annotations` and the map resets to `{}`.

### Deleting receivers

A receiver that a route still targets cannot be deleted:
`DELETE /v1/receivers/:name` answers `409` with the referring route ids.
Deleting it would leave those routes pointing at nothing, so every alert they
match would be dropped without a notification. Drop or repoint those routes
first.

## 3. Create routes

A route says "events matching these labels go to this receiver." Routes form an
ordered tree evaluated by priority. The receiver must already exist: a route
naming one that does not is rejected with `422` (`unknown receiver: oncall`),
so create receivers before the routes that target them.

```bash
curl -s -X POST localhost:8080/v1/routes -H "X-CC-Tenant: $TENANT" \
  -H 'Content-Type: application/json' \
  -d '{
    "matchers": [{ "label": "severity", "op": "eq", "value": "critical" }],
    "receiver": "oncall",
    "priority": 0
  }'
```

### Matching

Matchers run against the event's labels **plus** the synthetic labels the
dispatcher injects (they win over any same-named user label):

- `severity`: the event's severity.
- `status`: `firing`/`resolved`.
- `rule`: the originating rule id.
- `kind`: `alert` for ordinary alerts, `rule_health` for
  [rule-health events](observe-degraded-rules.md).
- `slo`: the SLO id, present **only** on SLO-originated events. Match on `slo`
  (or a tier via the `slo_tier` event label) to route, silence, or inhibit
  burn-rate alerts without touching ordinary rule alerts.

All matchers in a route must match (AND); an empty matcher list matches
everything (a catch-all). Operators: `eq`, `ne`, `regex`, `notregex` (regex is
fully anchored). A missing label reads as empty string.

### Order, priority, and `continue`

- Routes are evaluated in **priority ascending**, then creation order.
- The **first** matching route's receiver is selected and evaluation stops…
- …unless that route sets `"continue": true`, in which case later routes are also
  considered (fan-out to multiple receivers). Duplicate receivers are collapsed,
  keeping the first match's grouping parameters.

A common shape: page criticals, Slack everything, with a catch-all:

```jsonc
// priority 0: criticals to the oncall receiver, keep going
{ "matchers": [{"label":"severity","op":"eq","value":"critical"}],
  "receiver": "oncall", "priority": 0, "continue": true }
// priority 10: everything to Slack
{ "matchers": [], "receiver": "team-slack", "priority": 10 }
```

## 4. Tune grouping

Routed alerts are **grouped** before delivery so a burst becomes one notification.
Four per-route knobs (all optional, with defaults):

| Field                 | Default                | Meaning |
| --------------------- | ---------------------- | ------- |
| `group_by`            | `["rule","severity"]`  | Events sharing these label values form one group. |
| `group_wait_secs`     | `10`                   | Hold a new group this long before the first send (lets a burst coalesce). |
| `group_interval_secs` | `300`                  | Minimum spacing between subsequent sends for the same group. |
| `repeat_interval_secs` | none                  | Re-send a reminder for still-firing alerts after this long (min 60). Unset = never remind, the classic "notify on change only" behavior. |

Example: group page-outs per cluster, send fast, then at most every minute:

```bash
-d '{ "matchers": [{"label":"severity","op":"eq","value":"critical"}],
      "receiver": "oncall",
      "group_by": ["cluster"],
      "group_wait_secs": 5,
      "group_interval_secs": 60 }'
```

> The group wait is your **delivery-latency floor** for routed alerts. If a routed
> alert "takes 10 seconds to arrive," that's the default `group_wait_secs`.

### Still-firing reminders (`repeat_interval_secs`)

By default a group is notified when its active set changes (new alert fires,
an alert resolves) and then goes quiet. If an alert fires for three days and
nobody acts, nothing is re-sent. Set `repeat_interval_secs` on the route to get
periodic reminders while alerts are still firing:

```bash
curl -s -X PUT localhost:8080/v1/routes/$ROUTE_ID -H "X-CC-Tenant: $TENANT" \
  -H 'Content-Type: application/json' \
  -d '{ "matchers": [{"label":"severity","op":"eq","value":"critical"}],
        "receiver": "oncall",
        "repeat_interval_secs": 14400 }'
```

How reminders behave:

- A reminder carries the group's **still-firing set** and renders exactly like a
  normal notification for the channel.
- Reminders honor silences and inhibitions **at send time**: a silence created
  after the original notification suppresses the reminders too. The reminder
  schedule survives the silence, so reminders resume when it expires.
- Once every alert in the group resolves, reminders stop. The resolve
  notification itself is sent as usual.
- The cadence rides on the flush machinery, so a reminder can arrive up to one
  flush tick after the interval elapses. A normal flush (new alert joining the
  group) resets the reminder clock: you will not get a reminder moments after a
  regular notification.
- The minimum is 60 seconds (`422` below that). In practice you want minutes to
  hours; pick a value larger than `group_interval_secs`.

One caveat: reminders track firing membership per group. If your route matchers
or `group_by` split firing and resolved events into different groups (matching
or grouping on the synthetic `status` label), resolves cannot clear the firing
membership and reminders continue until the group's Redis state expires. Do not
match or group on `status` for routes that use `repeat_interval_secs`.

### Editing routes

`PUT /v1/routes/:id` replaces a route in full with the same body shape and
validation as create; omitted optional fields reset to their defaults. Grouping
changes (including `repeat_interval_secs`) take effect for a group the next
time an event is buffered into it.

## 5. No routes? Use subscriptions (firehose)

If a tenant has **no routes at all**, the dispatcher falls back to a firehose:
every event is delivered **immediately, one per notification**, to every
registered subscription. This is the zero-config path.

```bash
curl -s -X POST localhost:8080/v1/subscriptions -H "X-CC-Tenant: $TENANT" \
  -H 'Content-Type: application/json' \
  -d '{ "webhook_url": "https://example/firehose" }'
```

The moment you add your first route, the tenant switches to the routing tree and
subscriptions are no longer used for that tenant.

## 6. Verify delivery

- Every delivery attempt is logged in the `notifications` table (status
  pending/sent/failed, attempt count, last error: with the secret target stored
  only as a redacted digest).
- Permanently-undeliverable events land on the `cc:events:deadletter` Redis stream
  (`redis-cli XLEN cc:events:deadletter`).
- Transient failures are retried with exponential backoff, up to 4 attempts in
  total (the first try plus up to 3 retries); 4xx is treated as permanent and
  not retried, except that Slack and Telegram treat a 429 rate limit as
  transient. See [tunables](../reference/tunables.md#dispatcher).

## Next

- Quiet alerts during maintenance or noisy incidents:
  [silences and inhibitions](suppress-with-silences-and-inhibitions.md).
- Understand the full path an event takes: [the dispatch pipeline](../explanation/dispatch-pipeline.md).
