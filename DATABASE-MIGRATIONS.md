# Database migrations

App and Cloud share the application PostgreSQL schema and its migration history.
Cloud adds billing tables through its own history. App and Cloud use separate
PostgreSQL databases in the development stack and in their deployments. Each
Cloud database runs both histories.

## Ownership

| Location                     | Owns                                        | Tracking table                     |
| ---------------------------- | ------------------------------------------- | ---------------------------------- |
| `packages/app/drizzle`       | Shared application tables                   | `drizzle.__drizzle_migrations`     |
| `packages/cloud/src/drizzle` | Billing, subscriptions, and checkout tables | `drizzle.__everr_cloud_migrations` |

Tracking tables record applied migrations. They do not isolate SQL objects, so
each table definition needs one owner. Make shared schema changes in App and
Cloud-only changes in Cloud. Do not generate migrations while iterating on schema
changes.

## Startup

App applies the App history to its database. Cloud applies the App history
followed by its own history to a separate database. Both applications run
migrations during server startup. Production builds include the executable SQL
and journals under `.output/drizzle`.

This migration code does not upgrade pre-split Cloud databases directly.
Restored Cloud databases must already contain the App and Cloud migration
baselines.

## ClickHouse

| Location                              | Owns                                           | Applied by |
| ------------------------------------- | ---------------------------------------------- | ---------- |
| `packages/app/clickhouse/shared`      | `otel` landing tables, `app` tables, functions | App, Cloud |
| `packages/app/clickhouse/self-hosted` | Installation-wide users and SQL API user       | App        |
| `packages/cloud/clickhouse`           | Tenant row policies, provisioning grants       | Cloud      |

Each application applies its files in file-name order across its directories,
after its PostgreSQL migrations and under the same lock. Vite bundles the SQL
into the server, and `default.everr_clickhouse_migrations` records each applied
file name with a SHA-256 of its statements (comments do not count).

| File                           | Holds                                               | When its statements change             |
| ------------------------------ | --------------------------------------------------- | -------------------------------------- |
| `<dir>/NN-name.sql`            | Tables, views, columns, users                       | Startup fails. Add a new file instead. |
| `<dir>/repeatable/NN-name.sql` | Functions, row policies, other `OR REPLACE` objects | Applied again on the next startup.     |

A repeatable file keeps its number, so it runs in order with the others: a
function that a view uses must sort before the view. Put a file in
`repeatable/` only when every statement replaces what it creates
(`CREATE OR REPLACE`).

ClickHouse DDL is not transactional. A file that fails partway runs again from
its first statement, so every statement must be safe to repeat (`IF NOT EXISTS`,
`OR REPLACE`). Statements run with `mutations_sync = 2`, so an `ALTER` that
rewrites data finishes, or fails startup, before the app serves requests.

The collector and an App of another version can read the same tables, so
change `otel.*` and `app.*` in two releases: add the new column or table first,
and drop or rename the old one in a later release. When the journal lists files
this build does not bundle (after a downgrade), startup logs
`clickhouse.migration.unknown` and continues.

Startup applies them only when `CLICKHOUSE_MIGRATION_PASSWORD` is set, connecting
as `CLICKHOUSE_MIGRATION_USERNAME` (default `default`). Statements bind the other
users' passwords as `{name:String}` parameters. `GRANT` does not accept
parameters, so a parameterized user gets its role through `DEFAULT ROLE`.
`pnpm db:migrate` applies only the PostgreSQL histories.

## Verification

Use separate disposable PostgreSQL databases before changing an existing
installation. Check fresh and repeated App startup against the App database,
fresh and repeated Cloud startup against the Cloud database, and preservation of
each product's data.
