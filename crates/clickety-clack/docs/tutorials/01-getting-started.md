# Getting started

This tutorial takes you from an empty shell to a working alert. By the end you
will have run the engine, created a rule, registered a webhook receiver, routed
the rule to it, and watched an alert fire and resolve.

It is a **learning** exercise: every command is meant to be typed in order. We
optimize for "it works and you understand what happened", not for production
hardening. For production wiring see the
[how-to guides](../how-to/run-and-deploy-roles.md).

## What you will need

- The clickety-clack repository checked out, with the Rust toolchain it pins
  (1.94.1: `rustup` installs it automatically from `rust-toolchain.toml`).
- **PostgreSQL**, **Redis**, and **ClickHouse** reachable locally. The defaults
  expect:
  - Postgres at `postgres://postgres:postgres@127.0.0.1:5432/postgres`
  - Redis at `redis://127.0.0.1:6379`
  - ClickHouse at `http://127.0.0.1:8123` (user `default`, empty password)
- `curl` and a UUID for your tenant. Generate one now and keep it in a variable:

```bash
export TENANT=$(uuidgen | tr '[:upper:]' '[:lower:]')
echo "Acting as tenant: $TENANT"
```

> clickety-clack is **multi-tenant**. Every API call is scoped to a tenant via
> the `X-CC-Tenant` header. There is no login here because the crate's
> `.cargo/config.toml` sets `CC_DEV_INSECURE_NO_AUTH=1` for cargo-launched
> processes; a deployed binary refuses to start the api role without
> `CC_API_KEYS`.

## Step 1: Provide a key and start the engine

clickety-clack encrypts delivery secrets at rest and **refuses to start** without
a key (this is deliberate: see the [security model](../explanation/security-model.md)).
For the tutorial we generate one throwaway 256-bit key and register it as the
active key:

```bash
export CC_SECRET_KEYS="dev:$(head -c 32 /dev/urandom | base64)"
export CC_SECRET_ACTIVE_KEY="dev"
```

Now run every role in a single process with `CC_ROLE=all` (the default). The
tutorial stack queries ClickHouse as the `default` user, which the engine
refuses under shared auth unless a dev flag accepts the risk; for cargo runs
the crate's `.cargo/config.toml` sets that flag (see
[harden ClickHouse access](../how-to/harden-clickhouse-access.md)):

```bash
CC_ROLE=all cargo run
```

On boot the binary builds the cipher, connects to Postgres and **runs its own
migrations**, connects to Redis and ClickHouse, and starts serving. You should
see a log line like `api listening` on `0.0.0.0:8080`. Leave it running and open
a second terminal (re-export `TENANT` there).

> If it exits immediately with `CC_SECRET_KEYS required for env provider`, the
> key variables above are not set in the shell that launched it.

## Step 2: Check it is alive

```bash
curl -s localhost:8080/healthz   # => ok
curl -s localhost:8080/readyz    # => ok
```

## Step 3: Create an alert rule

A rule is a SQL `SELECT` against ClickHouse plus the metadata that turns its
result rows into alert instances. This one fires when any host's error rate
exceeds a threshold:

```bash
curl -s -X POST localhost:8080/v1/rules \
  -H "X-CC-Tenant: $TENANT" -H 'Content-Type: application/json' \
  -d '{
    "name": "default/high-error-rate",
    "sql": "SELECT host, errors FROM error_rates WHERE errors > 100",
    "interval_secs": 30,
    "for_secs": 60,
    "label_columns": ["host"],
    "value_column": "errors",
    "severity": "critical"
  }'
```

What each field means:

- `name` is the rule's stable identity, unique per tenant and namespace (this one
  leaves `namespace` at its default `""`). Creating a second rule with the same
  name is a `409`.
- `sql`: the query. It must be a read-only `SELECT` (validated on the way in).
- `interval_secs`: evaluate every 30 seconds.
- `for_secs`: the condition must hold continuously for 60 seconds before the
  alert actually fires (this is the "for duration"; set `0` to fire immediately).
- `label_columns`: the `host` column identifies *which* instance each row is.
  Two rows with different `host` values are two independent alerts.
- `value_column`: carry `errors` along as the numeric value.
- `severity`: one of `info`, `warning`, `critical`.

The response echoes the stored rule including its server-assigned `id`. Save it:

```bash
export RULE_ID=...   # the "id" from the response
```

## Step 4: Watch the alert state

In your second terminal, poll the alert list. It returns every pending/firing
instance for your tenant:

```bash
watch -n 5 'curl -s localhost:8080/v1/alerts -H "X-CC-Tenant: '"$TENANT"'"'
```

Leave this running. When your ClickHouse `error_rates` data crosses the threshold,
an instance appears here as `pending`, then `firing` once it has held for 60
seconds; when the rows drop below the threshold, the instance leaves the list.

> No data yet? The rule only fires on rows your SQL actually returns. Insert a row
> into ClickHouse that matches the `WHERE` clause to drive it, or adjust the SQL
> to something you can control.

## Step 5: Deliver to a receiver instead of just watching

Polling is handy for humans, but real delivery goes through **channels**,
**receivers**, and **routes**. Create a webhook channel (use any URL you can
inspect, e.g. a [webhook.site](https://webhook.site) endpoint), then a receiver
that references it by name:

```bash
curl -s -X POST localhost:8080/v1/channels \
  -H "X-CC-Tenant: $TENANT" -H 'Content-Type: application/json' \
  -d '{
    "name": "oncall-hook",
    "config": { "type": "webhook", "url": "https://webhook.site/your-id" }
  }'

curl -s -X POST localhost:8080/v1/receivers \
  -H "X-CC-Tenant: $TENANT" -H 'Content-Type: application/json' \
  -d '{ "name": "oncall", "channels": ["oncall-hook"] }'
```

Then route critical alerts to it:

```bash
curl -s -X POST localhost:8080/v1/routes \
  -H "X-CC-Tenant: $TENANT" -H 'Content-Type: application/json' \
  -d '{
    "matchers": [{ "label": "severity", "op": "eq", "value": "critical" }],
    "receiver": "oncall"
  }'
```

Now when the rule fires, the dispatcher matches the event's `severity=critical`
against your route and delivers a batched JSON payload to the webhook. Grouping
defaults to `["rule", "severity"]`, so alerts from this rule at the same severity
travel as one batch, held briefly before the first send (10 seconds). See
[routing and grouping](../how-to/configure-receivers-and-routing.md) to tune this.

> **Routes are required for delivery.** Events that do not match a route are
> recorded but not delivered. Add a catch-all route with no matchers when every
> alert should reach a receiver.

## Step 6: Silence it while you work

Suppose you are doing maintenance on `host=web-1` and don't want pages. Create a
silence that suppresses anything labelled `host=web-1` for the next hour:

```bash
curl -s -X POST localhost:8080/v1/silences \
  -H "X-CC-Tenant: $TENANT" -H 'Content-Type: application/json' \
  -d '{
    "matchers": [{ "label": "host", "op": "eq", "value": "web-1" }],
    "starts_at": "2026-06-14T00:00:00Z",
    "ends_at":   "2026-06-14T01:00:00Z",
    "comment":   "maintenance",
    "author":    "you"
  }'
```

While the silence is active, matching events are dropped before delivery: both
firing *and* resolved. (Adjust the timestamps to span "now".)

## What you built

You now have the whole pipeline working end to end:

```
rule (SQL) ──scheduler──▶ eval job ──evaluator──▶ event ──dispatcher──▶ webhook
                                                     │
                                          silences / inhibitions / routing
```

## Where to go next

- Understand what just happened: [the evaluation model](../explanation/evaluation-model.md)
  and [the dispatch pipeline](../explanation/dispatch-pipeline.md).
- Do real tasks: [write alert rules](../how-to/write-alert-rules.md),
  [configure receivers and routing](../how-to/configure-receivers-and-routing.md).
- Look things up: [the HTTP API reference](../reference/http-api.md) and
  [configuration reference](../reference/configuration.md).
