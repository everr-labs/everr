# What the alerting branch adds, and why

This is the high-level companion to
[02-alerting-clickhouse-surface.md](02-alerting-clickhouse-surface.md). That
document is the technical design. This one says what we are building on top
of main and why it is worth building, in plain terms.

## What main already does

Main ships a working alert engine. It scans rules on a schedule, runs each
rule's query, and sends a notification to Slack or Telegram when the rule
fires. It supports silences: a person can mute matching alerts for a time
window.

What main does not do is remember. It has almost no durable state: no record
of which alerts fired last week, no record of what was delivered and
whether it succeeded, no way to look back at an incident. It evaluates and
sends, then forgets.

## What the branch adds

Three things, each built on the previous one.

### 1. The engine remembers

Every meaningful event gets a durable record: an alert started firing, it
recovered, a notification was held back, a delivery succeeded or failed.
PostgreSQL keeps the live state and a journal of decisions. This turns
alerting from a stateless pipe into a system with a history.

### 2. Notifications become a pipeline, not a pipe

Main sends every firing alert to its channels immediately. The branch adds
the control layer that real on-call needs:

- **Routing and receivers.** Rules map to named receivers, and receivers
  map to channels, so "who gets paged" is configuration, not code.
- **Grouping.** Related alerts batch into one notification instead of
  paging once per instance.
- **Silences, deepened.** A silence now defers a notification instead of
  dropping it: when the silence ends and the alert still fires, the
  notification goes out late rather than never.
- **Inhibitions.** One alert can hold back another, so a root cause does
  not page alongside its twenty symptoms.
- **Delivery tracking.** Every send attempt is recorded with its outcome,
  so "did anyone actually get paged" has an answer.

### 3. History becomes queryable, by people and by agents

Everr's thesis is that observability is SQL: you query your data, you do
not click through fixed screens. Alerting joins that. The full alert
history lands in ClickHouse as one table that `everr cloud query` can read,
so anyone can ask:

- What is firing right now, since when, at what value?
- How did this alert behave over the last month?
- Was this notification delivered, when, and did it succeed?
- Why did nobody get paged at 03:00? Was it silenced, inhibited, or lost?

The demanding caller here is an AI agent. An agent gets one query and no
second chance: it cannot poke around, retry with a cast, or join to a
second database. So every row must be readable on its own, every fact must
be a typed column, and the schema must fit in the documentation an agent
carries. That last one is the constraint the design did not meet: 28
columns take about three pages, not one, and it is recorded as a design
signal rather than papered over. The first two shape most of the design,
and they make the surface better for humans too.

## The rules the design holds itself to

- **A missing row must never read as a false "no".** During an incident,
  "nothing fired" and "the record was lost" must not look the same. Rows
  that matter are journaled in PostgreSQL first. The repair that would carry
  a dropped insert into ClickHouse is designed and deliberately not built, so
  the surface is best effort and an absent row means unknown.
- **Nothing irreversible.** The history store is append-only, so no
  secrets and no personal data ever land in it. Erasure stays a simple
  delete in PostgreSQL.
- **Alerting stays as-code.** Rules, channels and routing are applied via
  `everr apply`. The UI shows and explains; it does not edit.

## What ships first

Main already proves the evaluate-and-send loop, so the risk is not the
engine. The plan ships in two phases:

1. **Shipped:** the pieces that cannot be changed later. The history
   table's final shape, the database migration while it was still
   unshipped, and the permissions that let `cloud query` reach the table
   at all.
2. **Later, additive:** everything else lands incrementally: the repair
   job, the held-notification records, the live-state view, the audit
   trail. Until each lands, the surface is honest about being best-effort.

Both halves, what shipped and what is left, are in
[03-where-the-work-stands.md](03-where-the-work-stands.md), with one
ticket per unit of work in [tickets/](tickets/).

## 2026-08-18 update

The Alertmanager-style routing tree described elsewhere in these documents
no longer exists. Delivery is now: every alert goes to the organization's
default destination (one channel list, optionally split by severity) unless
its rule names `spec.notifications.channels`. Silences are the only
suppression mechanism. Grouping is fixed and repeats are gone. Read
route/receiver/inhibition passages below as history.
