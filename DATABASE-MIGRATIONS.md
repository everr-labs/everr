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

| Location                              | Owns                                     | Applied by |
| ------------------------------------- | ---------------------------------------- | ---------- |
| `packages/app/clickhouse/shared`      | Databases, base users, tables, functions | App, Cloud |
| `packages/app/clickhouse/self-hosted` | Installation-wide SQL API role and user  | App        |
| `packages/cloud/clickhouse`           | Tenant row policies, provisioning grants | Cloud      |

Each application applies its files in file-name order across its directories,
after its PostgreSQL migrations and under the same lock. Vite bundles the SQL
into the server, and `default.everr_clickhouse_migrations` records each applied
file name with a SHA-256 of the file as written.

Applied files are immutable. If an applied file changes at all, a comment
included, startup fails before running anything. A pull request fails the same check against the
base branch, so a changed or deleted migration cannot merge. Put every change
in a new file with the next number, including a new version of a function
(`CREATE OR REPLACE FUNCTION`).

The runner sends a file one statement at a time: it drops `--` line comments
and splits on `;`. Do not put `;` or `--` inside a quoted string, and do not
use block comments.

ClickHouse DDL is not transactional. A file that fails partway runs again from
its first statement, so every statement must be safe to repeat (`IF NOT EXISTS`,
`OR REPLACE`). Use `OR REPLACE` for a row policy, not `DROP` then `CREATE`: the
table has no tenant filter between the two statements.

Startup applies them only when `CLICKHOUSE_MIGRATION_PASSWORD` is set, connecting
as `CLICKHOUSE_MIGRATION_USERNAME` (default `default`) with a 10-minute request
timeout. A timed-out statement can still be running on the server. The retry
sends the same query id with `replace_running_query`, so ClickHouse cancels
that run before starting it again. Statements bind the other users' passwords
as `{name:String}` parameters. `GRANT` does not accept parameters, so a
parameterized user gets its role through `DEFAULT ROLE`.
`pnpm db:migrate` applies only the PostgreSQL histories.

## Verification

Use separate disposable PostgreSQL databases before changing an existing
installation. Check fresh and repeated App startup against the App database,
fresh and repeated Cloud startup against the Cloud database, and preservation of
each product's data.
