# Usage accounting

The Cloud distribution measures what each customer sends. Every admitted OTLP or GitHub batch adds its size to a per-customer, per-signal counter; the usage connector publishes the counters as the cumulative sum `everr.ingestion.volume` (unit `By`) every 60s and on shutdown, through its own durable exporter queue, to `app.metrics_sum` with 365-day retention. Billing and the usage dashboard read it with `collector/extension/everrusageextension/customer-usage.sql`.

## Sub-features

- `usage-published`: after ingest, `app.metrics_sum` has `everr.ingestion.volume` rows with `Attributes['everr.usage.tenant.id']` equal to `tenant_id`, one stream per signal, `retention_days` `365`.
- `usage-shutdown`: SIGTERM publishes the final counters; after `$V restart` the totals include everything sent before it.
- `usage-monthly`: the canonical query returns one row per customer and signal with `bytes` greater than 0.
- `usage-per-tenant`: two keys produce two customers; the other tenant's bytes stay under its own tenant.
- `usage-durability`: crash recovery, ambiguous retries, idle expiry and shutdown, covered by `collector/test/smoke/usage.py` against this run's ClickHouse.

## How to get to it (user POV)

- Any authenticated ingest (OTLP or GitHub) into a Cloud collector.
- The Cloud usage dashboard and billing, which run the canonical query.

## Driving it with verify-collector

Preconditions:

- A run with `--profile cloud` (the only profile with the usage pipeline).
- `$V doctor` prints `COLLECTOR DOCTOR OK`.

- **Ingest.** Run `$V otlp usage-logs-a logs`, `$V otlp usage-traces-a traces` and `$V otlp usage-logs-b logs --key other`. Each `--- HTTP 200`.
- **Flush.** Run `$V restart`. Prints `exited ... after SIGTERM`, the collector's `Shutdown complete.` line and `COLLECTOR RESTARTED`.
- **Proof, rows.** Run `$V ch-until usage-rows everr.ingestion.volume "SELECT MetricName, tenant_id, Attributes['everr.usage.tenant.id'] AS customer, Attributes['everr.ingestion.signal'] AS signal, retention_days, Value FROM app.metrics_sum WHERE MetricName = 'everr.ingestion.volume' ORDER BY customer, signal"`. Rows for tenant a (`logs`, `traces`) and tenant b (`logs`), `customer` equal to `tenant_id`, `retention_days` `365`, `Value` above 0.
- **Proof, monthly query.** Run `$V ch usage-monthly --param month=$(date -u +%Y-%m) --file collector/extension/everrusageextension/customer-usage.sql`. The same customers and signals with `bytes` above 0.
- **Durability matrix.** Run `eval "$($V env)"; CLICKHOUSE_PASSWORD=dev python3 -I collector/test/smoke/usage.py --container "$COMPOSE_PROJECT-clickhouse-cloud-1" --clickhouse "$CLICKHOUSE_ORIGIN" | tee "$EVIDENCE/usage-smoke.txt"`. Expect five `PASS:` lines in about 90s. It starts its own collector from `collector/build/cloud` with a proxy in front of ClickHouse, and writes synthetic `usage-smoke-*` tenants into this run's database.

## Gotchas

- `usage.py` at e4554bb51 stops at its second check with `FileNotFoundError` for `packages/app/src/data/dashboards/built-in/catalog/everr/telemetry-usage.yaml`: the dashboard moved to `packages/cloud/src/data/dashboards/telemetry-usage.yaml`. With that one path changed it passes all five checks against this run. Until the script is fixed, report `usage-durability` as blocked by the stale path.
- Without `$V restart`, rows appear only after the 60s interval in `scripts/dev/collector-cloud.yaml`. Use `UNTIL_S=90` on `ch-until` if you wait instead.
- The counters measure admitted bytes, so exact `Value`s depend on payload size. Assert presence, ownership and growth, not a fixed number.
- Usage counts what the collector admitted, not what was stored: a webhook whose rows the retention TTL drops at insert (`github-webhook.md`, `gh-ttl`) still shows up as `traces` usage for its tenant.
- `customer-usage.sql` reads `FROM metrics_sum` without a database. `$V ch` runs with database `app`, which resolves it.
