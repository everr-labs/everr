# clickety-clack documentation

clickety-clack is a headless, multi-tenant alerting engine. It evaluates raw-SQL
alert rules against ClickHouse, tracks per-instance firing/resolved state with a
for-duration state machine, and dispatches notifications (Slack, email, PagerDuty,
generic webhook) with Alertmanager-class routing, grouping, deduplication,
silencing, and inhibition. State lives in PostgreSQL; the hot path runs on Redis
Streams.

These docs follow the [Diátaxis](https://diataxis.fr/) framework. Pick the column
that matches what you are trying to do:

| If you want to…                              | Go to                              |
| -------------------------------------------- | ---------------------------------- |
| **Learn** the system by doing                | [Tutorials](#tutorials)            |
| **Accomplish a specific task**               | [How-to guides](#how-to-guides)    |
| **Look up** an exact value, field, or route  | [Reference](#reference)            |
| **Understand** why it works the way it does  | [Explanation](#explanation)        |

---

## Tutorials

*Learning-oriented. Start here if you are new.*

- [Getting started](tutorials/01-getting-started.md) — bring up the dependencies,
  run the engine, create your first rule, route it to a webhook, and watch it
  fire and resolve.

## How-to guides

*Task-oriented. You know what you want; these show the steps.*

- [Run and deploy the roles](how-to/run-and-deploy-roles.md)
- [Write alert rules](how-to/write-alert-rules.md)
- [Configure receivers and routing](how-to/configure-receivers-and-routing.md)
- [Suppress alerts with silences and inhibitions](how-to/suppress-with-silences-and-inhibitions.md)
- [Observe and respond to degraded rules](how-to/observe-degraded-rules.md)
- [Monitor the engine](how-to/monitor-the-engine.md)
- [Manage secret encryption and rotate keys](how-to/manage-secret-encryption.md)
- [Harden the ClickHouse user](how-to/harden-clickhouse-access.md)
- [Operate at scale](how-to/operate-at-scale.md)

## Reference

*Information-oriented. Dry, exhaustive, accurate.*

- [Configuration (environment variables)](reference/configuration.md)
- [HTTP API](reference/http-api.md)
- [Data model](reference/data-model.md)
- [Storage: Postgres tables, Redis keys, migrations](reference/storage-and-keys.md)
- [Tunables and defaults](reference/tunables.md)

## Explanation

*Understanding-oriented. The "why" and the design trade-offs.*

- [Architecture overview](explanation/architecture.md)
- [The evaluation model and state machine](explanation/evaluation-model.md)
- [The dispatch pipeline](explanation/dispatch-pipeline.md)
- [Durability and delivery guarantees](explanation/durability-and-delivery.md)
- [The security model: secret encryption at rest](explanation/security-model.md)

---

## The shape of the system in one paragraph

A **scheduler** decides which rules are due and enqueues evaluation jobs onto a
Redis stream. An **evaluator** consumes those jobs, runs each rule's SQL against
ClickHouse, advances a per-instance state machine, and publishes
firing/resolved **events** onto a second Redis stream (transactionally, via an
outbox). A **dispatcher** consumes events, applies silences and inhibitions,
routes each event to receivers, groups and deduplicates them, and delivers
notifications with bounded retry and a dead-letter stream. An **api** role
exposes the management HTTP API and a Server-Sent-Events firehose. All four roles
are the same binary, selected by `CC_ROLE`; run them together (`all`) for
development or separately for production scale.
