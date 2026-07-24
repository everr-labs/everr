# clickety-clack

A headless, multi-tenant alerting engine. It evaluates raw-SQL alert rules against
ClickHouse, tracks per-instance firing/resolved state with a for-duration state
machine, and dispatches notifications (Slack, email, generic webhook)
with Alertmanager-class routing, grouping, deduplication, silencing, and
inhibition. Durable state lives in PostgreSQL; the hot path runs on Redis Streams.

## Roles

One binary (`cc`), role-selected by `CC_ROLE`: `api`, `scheduler`, `evaluator`,
`dispatcher`, or `all`. The roles coordinate only through Postgres and Redis, so
each scales independently.

## Quick start

```bash
# A key is required — the engine is fail-closed without one.
export CC_SECRET_KEYS="dev:$(head -c 32 /dev/urandom | base64)"
export CC_SECRET_ACTIVE_KEY=dev

CC_ROLE=all cargo run        # needs Postgres, Redis, ClickHouse reachable
```

Then walk through the [getting-started tutorial](docs/tutorials/01-getting-started.md).

## Documentation

Full documentation lives in [`docs/`](docs/README.md), organized by the
[Diátaxis](https://diataxis.fr/) framework:

- **Tutorials** — [getting started](docs/tutorials/01-getting-started.md)
- **How-to guides** — [run & deploy](docs/how-to/run-and-deploy-roles.md),
  [write rules](docs/how-to/write-alert-rules.md),
  [receivers & routing](docs/how-to/configure-receivers-and-routing.md),
  [silences & inhibitions](docs/how-to/suppress-with-silences-and-inhibitions.md),
  [secret encryption](docs/how-to/manage-secret-encryption.md),
  [operate at scale](docs/how-to/operate-at-scale.md)
- **Reference** — [configuration](docs/reference/configuration.md),
  [HTTP API](docs/reference/http-api.md),
  [data model](docs/reference/data-model.md),
  [storage & keys](docs/reference/storage-and-keys.md),
  [tunables](docs/reference/tunables.md)
- **Explanation** — [architecture](docs/explanation/architecture.md),
  [evaluation model](docs/explanation/evaluation-model.md),
  [dispatch pipeline](docs/explanation/dispatch-pipeline.md),
  [durability & delivery](docs/explanation/durability-and-delivery.md),
  [security model](docs/explanation/security-model.md)

The full design specs and implementation plans are under `docs/superpowers/`.
