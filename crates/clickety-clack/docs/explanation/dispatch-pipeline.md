# The dispatch pipeline

This explains what happens to an event between "the evaluator published it" and
"a notification arrived": every stage, in order, and why each exists.

## The stages

When the dispatcher consumes an event from `cc:events`, it runs it through this
pipeline:

```
event ─▶ build match labels ─▶ silence? ─▶ inhibition? ─▶ routes? ─┬─yes─▶ group ─▶ (flush) ─▶ dedup ─▶ deliver
                                  │drop        │drop               └─no──▶ firehose ─▶ dedup ─▶ deliver
                                  ▼            ▼
                               (dropped)   (dropped)
```

### 0. Build match labels
Every event is augmented with **synthetic labels** before any matching:
`severity`, `status` (`firing`/`resolved`), and `rule` (the UUID). These join the
event's real labels in one namespace, so routes/silences/inhibitions can match on
severity or rule without those being real data columns. Synthetic labels win on
collision.

### 1. Silence
If any **active** silence (now within `[starts_at, ends_at)`) matches the labels,
the event is **dropped**: both firing and resolved. Silences are operator-driven,
time-boxed muting. See [suppress with silences](../how-to/suppress-with-silences-and-inhibitions.md#silences).

### 2. Inhibition
If an inhibition rule applies: the event matches a `target_matchers`, a different
**firing** instance matches the `source_matchers`, they agree on the `equal`
labels, and the event isn't itself a source: the event is **dropped**. This is
automatic, dependency-driven muting ("cluster down ⇒ hush the per-service
warnings").

> Both filters run **at ingest** and are **re-applied at flush**, each time
> against a per-tenant snapshot (silences, inhibitions, firing set) cached for
> ~2 seconds per dispatcher replica. This is why a brand-new silence can take
> up to ~2s to take effect.

### 3a. Routing (the normal path)
If the tenant has routes, the event is matched against them in priority order. The
first matching route selects a receiver; `continue: true` lets later routes also
match (fan-out). Duplicate receivers collapse, keeping the first match's grouping
parameters. Each selected receiver becomes a **delivery target**.

### 3b. Firehose (the no-routes fallback)
If the tenant has **no routes**, the event is delivered **immediately, one
notification per event**, to every subscription webhook. This is the zero-config
path; it bypasses grouping entirely.

### 4. Grouping
For routed targets, the event is **buffered** into a Redis group rather than sent
immediately. A group is identified by `group_by` label values (default
`["rule","severity"]`). Buffering uses a Redis hash per group keyed by instance,
so a later event for the same instance overwrites the earlier one (a resolve
supersedes its firing within the group). A flush timer is armed:

- First event in a new group: due at `now + group_wait_secs` (default 10s).
- After a flush, re-arrival: due at `max(now, last_flush + group_interval_secs)`
  (default 300s).

A separate **group flusher** loop (every 200ms) claims due groups atomically,
snapshots their events, resolves the receiver's channel names to their stored
configs (a channel deleted in the meantime is skipped with an error log), and
delivers them as one batched notification, fanned out to every resolved channel
(a failing channel never blocks the others). Grouping is
why a burst of related alerts becomes a single message, and why routed delivery
has a latency floor equal to `group_wait_secs`.

### 5. Deduplication
Before delivery, a **dedup key** is computed per channel: for groups, over
`(group_id, channel name, sorted active event set)`, so each channel of a
multi-channel receiver dedups independently while staying stable across config
edits (rotating a hook never re-sends an identical active set); for the
firehose, over the event's identity. The `notifications` table records it. Because Redis Streams are
at-least-once, the same event (or identical group snapshot) can be processed
twice; the dedup log ensures the notification is sent only once. A changed group
(different active set) yields a different key and a new notification.

### 6. Delivery
The notification is rendered for the channel and sent:

- **webhook**: POST `{group_key, events:[…]}` (raw events, annotations included,
  no rendering).
- **slack**: incoming-webhook message: a header plus one color-coded attachment
  per event.
- **email**: a plaintext SMTP message summarizing the group.
- **telegram**: one `sendMessage` per chat id (HTML parse mode), truncated to
  Telegram's 4096-character `text` limit.

For the rendered channels, alert events honor the rule's
[`summary`/`description`/`link.*` annotations](../how-to/write-alert-rules.md#annotations):
the substituted `summary` is each event's headline (falling back to the instance
key), and links render channel-natively (Slack buttons, Telegram/email links).
Channel escaping is applied after substitution.

## Retry, permanence, and dead-lettering

Delivery results are classified:

- **Success** (2xx / 202): recorded as sent.
- **Permanent** (4xx): not retried; the event is dead-lettered after the attempt.
- **Transient** (5xx, timeouts, connection errors, 429): retried with
  deterministic exponential backoff (`50ms · 2^attempt`, capped 5s), up to 4
  attempts, then dead-lettered.

Dead-lettered events go to the `cc:events:deadletter` stream for inspection and
manual recovery. The audit trail (`notifications` table) records attempts and the
last error: with any secret in the target stored only as a redacted digest.

## Important properties and trade-offs

- **Suppression is re-checked at flush.** Silence/inhibition decisions are made
  when the event arrives and again when its group flushes, against the
  then-current snapshot. An event buffered before you create a silence is still
  dropped at flush time; silence drops leave an audit record, inhibition drops
  do not.
- **Grouping is fan-out-safe.** Per-instance buffering plus a dedup key over the
  active set means redeliveries and overlapping flushes don't double-notify, and a
  resolve correctly supersedes its firing inside a group.
- **Per-replica cache lag.** The ~2s tenant snapshot trades a small propagation
  delay for not hitting Postgres on every event.
- **Secrets never leak in the audit path.** Redis group metas carry channel names
  only, resolved to stored configs at flush time; the audit/dead-letter/log target
  is a one-way digest; transport errors strip the URL. See
  [security model](security-model.md).

## See also

- Tuning the knobs: [configure receivers and routing](../how-to/configure-receivers-and-routing.md).
- The exact constants: [tunables](../reference/tunables.md#dispatcher).
- Delivery guarantees: [durability and delivery](durability-and-delivery.md).
