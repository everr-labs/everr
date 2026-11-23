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

Every migration is a file in `packages/app/clickhouse`. The tag after the number
selects the product that applies it. A file without a tag applies to both.

| File name                     | Owns                                     | Applied by |
| ----------------------------- | ---------------------------------------- | ---------- |
| `NNNN-<name>.sql`             | Databases, base users, tables, functions | App, Cloud |
| `NNNN-self-hosted-<name>.sql` | Installation-wide SQL API role and user  | App        |
| `NNNN-cloud-<name>.sql`       | Tenant row policies, provisioning grants | Cloud      |

The four-digit number is one sequence for all files, tagged or not. A number is
used once. A new file takes the next number.

Each application applies its files in file-name order, after its PostgreSQL
migrations and under the same lock. Vite bundles the SQL
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

### Seeds

A migration that needs more than SQL gets a seed: `NNNN-<name>.seed.ts`
next to `NNNN-<name>.sql`, with one function as its default export. Use it for
work that depends on what the server holds, such as one statement per existing
organization. Startup fails when the default export is not a function.

```ts
import type { ClickHouseSeed } from "../src/db/clickhouse-sql.ts";

const seed: ClickHouseSeed = async ({ query, command }) => {
  const users = await query<{ name: string }>(
    "SELECT name FROM system.users WHERE startsWith(name, {prefix:String})",
    { prefix: "sql_api_" },
  );
  for (const { name } of users) {
    await command("ALTER USER {name:Identifier} SETTINGS PROFILE 'sql_api_profile'", { name });
  }
};

export default seed;
```

`query` and `command` take the values for the `{name:Type}` placeholders as
their second argument. Pass every value that comes from the server this way.
Do not put it in the SQL string: a name can hold a backtick or a quote. `GRANT`
does not accept parameters, so check a name against a strict pattern before it
goes into a `GRANT`.

The runner calls the seed once, after the file's statements and before the
journal row, on the migration connection. A seed that throws leaves the
migration pending, so the next start runs the statements and the seed again.
Make it safe to repeat, and keep it short: startup waits for it under the
migration lock. A seed query gets a query id from its place in the seed's
call order, so the retry cancels a run of it that is still on the server, as
it does for a statement.

- The journal hashes the SQL file only. Editing a seed after its migration
  is applied changes nothing where it already ran. A new server runs the
  edited seed.
- A seed runs with its migration or never. Adding one to a migration that
  is already on the base branch fails the pull request check. Put it next to a
  new migration file, which can hold only a comment.
- Deleting a seed that is on the base branch fails the pull request check. A
  new server would apply the migration without it.
- A seed also runs on a new, empty server, and must do nothing wrong there.
- A seed sees the server once. Something the previous application version
  creates after that, during a rolling deploy, is not covered.

## Verification

Use separate disposable PostgreSQL databases before changing an existing
installation. Check fresh and repeated App startup against the App database,
fresh and repeated Cloud startup against the Cloud database, and preservation of
each product's data.
