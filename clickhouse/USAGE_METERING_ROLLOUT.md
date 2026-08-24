# Usage metering rollout

This procedure applies usage metering to an existing ClickHouse cluster. It
does not backfill historical usage. Run it only in an approved change window.

## 1. Preflight as the collector user

Run the executable preflight with the exact credentials and settings used by
the production collector:

```sh
./clickhouse/usage-metering-rollout.sh preflight \
  --host <host> --secure \
  --user collector_rw --password '<password>' \
  --async_insert=1 --wait_for_async_insert=1
```

Pass every setting from the collector's effective ClickHouse connection,
including settings supplied through its DSN. A plain client session that omits
those overrides does not prove the collector's effective behavior.

The check requires ClickHouse 26.1 or newer, explicit UTC support,
`asterisk_include_materialized_columns = 0`, materialized-view errors enabled,
asynchronous inserts that wait for completion, and dependent-view
deduplication. Stop before applying SQL if any check fails.

## 2. Apply as an administrator

Capture the command output in the deployment change record:

```sh
./clickhouse/usage-metering-rollout.sh apply \
  --host <host> --secure \
  --user <admin-user> --password '<password>' \
  | tee <change-record-path>
```

The output records the UTC start and finish of the apply. Each signal starts
metering when its materialized-view statement is created, so the exact seven
cutovers fall inside that recorded interval. The apply file has no additive
backfill and is safe to repeat.

`ADD COLUMN IF NOT EXISTS` installs missing `RowBytes` columns. The following
`MODIFY COLUMN` statements converge stale materialized expressions for future
inserts. ClickHouse does not rewrite old parts when a materialized expression
changes, by design. Old stored values remain unchanged and are not inserted
into the usage ledger.

## 3. Validate the installed schema

```sh
./clickhouse/usage-metering-rollout.sh validate-schema \
  --host <host> --secure \
  --user <admin-user> --password '<password>'
```

This checks the UTC ledger, engine, partition and sorting keys, lack of TTL,
all seven materialized columns and views, and the tenant row policy.

## 4. Validate fresh data through the real collector

Use a dedicated validation organization with no other ingest during the test.
Send at least one fresh trace, log, and metric through the production collector.
Add the same unique resource attribute to all three signals:

```text
everr.usage.validation.run_id=<unique-run-id>
```

Record the UTC arrival hour, then run:

```sh
USAGE_METERING_VALIDATION_TENANT_ID='<validation-org-id>' \
USAGE_METERING_VALIDATION_TENANT_IS_DEDICATED=yes \
USAGE_METERING_VALIDATION_RUN_ID='<unique-run-id>' \
USAGE_METERING_VALIDATION_BUCKET='2026-08-24 09:00:00' \
./clickhouse/usage-metering-rollout.sh validate-data \
  --host <host> --secure \
  --user <admin-user> --password '<password>'
```

The script requires nonzero tagged raw rows for every signal, then compares
their byte and item totals with the matching hourly ledger rows. The ledger is
aggregated only by organization, signal, and hour. It does not retain the test
run id, so exact comparison requires a quiet, dedicated validation organization
for that hour. This is an intentional privacy and cardinality tradeoff in the
approved ledger schema.
