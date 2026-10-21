# Database migrations and local application switching

The app and cloud application share one application database schema and its migration
history. Cloud adds billing tables through a separate history. Keeping the core
history shared lets developers switch applications against the same database
without applying the same schema changes twice.

## Histories

| Location                            | Purpose                                     | Tracking table                                     |
| ----------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| `packages/app/drizzle`              | Shared application tables                   | `drizzle.__drizzle_migrations`                     |
| `packages/cloud/src/drizzle`        | Billing, subscriptions, and checkout tables | `drizzle.__everr_cloud_migrations`                 |
| `packages/cloud/src/drizzle-legacy` | Upgrade databases created before the split  | Existing entries in `drizzle.__drizzle_migrations` |

Tracking tables record applied migrations. They do not isolate SQL objects or
prevent conflicting migrations. Each table definition must have a single owner.
Generate shared changes through the app's Drizzle configuration and billing
changes through the cloud configuration. Cloud runs app migrations before its
own migrations; the app runs only app migrations.

## Switching locally

A fresh database can start with the app. Starting cloud against that database
adds its tables and reuses the already applied app history. Returning to the
app leaves cloud tables and their data intact. Switching applications is not a
downgrade and does not remove columns or roll back migrations.

An existing database from before the split must first run the cloud migration
command. It finishes the original history, including copying billing fields out
of `organization`, and then atomically records the app and billing baselines as
already applied. Subsequent migrations run normally. The app alone cannot
perform that initial upgrade.

Use one application process at a time when testing this workflow. Both commands
must point at the same PostgreSQL database. The app also requires a single
workspace: a database with multiple organizations cannot be used unchanged,
even when its migration history is compatible.

## Removing the legacy history later

The legacy directory and adoption code are temporary compatibility support.
They can be removed once every supported existing database has completed the
transition. Document a transitional release that older installations and restored
backups must run before upgrading to a release without legacy support. Keep the
shared application history and its tracking table after removing legacy support.

## Verification

Migration generation and application should be checked against a disposable
PostgreSQL database before changing a developer's working database. Verify app
initialization, cloud initialization, returning to the app, repeated application,
and preservation of both shared and billing data. Also verify the legacy upgrade
path before removing or changing adoption code.

## Earlier exercise completed on 2026-10-17

This initial exercise used a separate application tracking table. The current
layout below preserves main's tracking table instead. The counts in this
historical exercise describe the earlier layout.

The flow was checked using an isolated PostgreSQL 17 container, not a developer's
working database. Both package generators initially reported no schema changes.
Temporary nullable probe columns were then used to exercise real generation:

1. Generate an app migration with `pnpm --filter @everr/app db:generate` and
   apply it with `pnpm --filter @everr/app db:migrate`.
2. Seed one workspace and a shared probe value. Start the app, confirm its
   sign-in page returns HTTP 200, and stop it.
3. Generate a billing migration with `pnpm --filter @everr/app-cloud db:generate`
   and run `pnpm --filter @everr/app-cloud db:migrate` against that same database.
   The generated SQL altered only `organization_billing`; it did not recreate
   or alter shared tables.
4. Seed a billing probe value, start cloud, and confirm the sign-in page returns
   HTTP 200 and renders in the browser. Stop cloud.
5. Run app migrations again and restart the app. Verify its sign-in page renders
   with invitation-only access. Both probe values remain unchanged. Each current
   migration history contains exactly two rows: its baseline and its probe.
6. Run cloud migrations again. Neither migration history gains another row.

A second disposable database was initialized with the original migrations
through `0012`. After seeding an organization with a plan and customer ID, the
cloud migration command successfully applied `0013`, preserved billing values,
removed the original billing columns, adopted both baselines, and applied both
probe migrations. Repeating cloud migration and then running app migration also
succeeded. The resulting history counts were 14 legacy, 2 application, and 2 cloud.

The temporary schema changes and generated probe migrations were removed after
verification. No production migration files were added. The temporary servers
were stopped and the disposable PostgreSQL container was removed. This verifies
schema generation, migration application, startup, and data preservation; it does
not exercise signup, billing transactions, or multi-workspace application behavior.

## Ordinary app naming

The app uses `packages/app/drizzle`, `0000_baseline.sql`, and Drizzle's default
`drizzle.__drizzle_migrations`, matching main's directory and tracking-table
names. Its configuration does not override the migration schema or table.
Cloud keeps its separate `__everr_cloud_migrations` table.

Production builds copy executable SQL and journals into `.output/drizzle`.
Cloud includes its additive history under `cloud` and its transition history
under `legacy`. This directory ships with the server output for both ordinary
Node startup and container images; generation snapshots are not included.

Legacy upgrade preserves the original tracking rows and appends the app baseline
marker to that same table. Adoption checks the baseline hash and timestamp,
not merely whether the table exists. A database initialized by the app already
has that marker, so cloud can add its own tables without running legacy SQL.

The app baseline timestamp follows the final legacy migration. Drizzle orders
migration application by timestamps, so a subsequent app migration must not
sort before the already recorded legacy history. The upgrade tests verify that
a later app migration actually executes after adoption.

Verification of this naming change covers fresh app-first and cloud-first
databases, switching repeatedly, and upgrading the original deployed history.
An upgraded database retains all 14 historical rows and appends the baseline
marker as row 15; the next app migration executes normally. A fresh database
records just the app baseline. The real PostgreSQL command sequence
app, cloud, app, cloud creates only `__drizzle_migrations` and
`__everr_cloud_migrations`, each with one baseline entry.

## Cloud startup against main's database

On 2026-10-17, the actual cloud development server was started against a fresh,
disposable PostgreSQL 17 database initialized from the exact migration files in
`origin/main` at `f77d0c3de6164e77fd656d4ee21106f3c5039bf6`. Before startup,
the database had 13 original migration entries, no `organization_billing` table,
and no cloud migration tracking table. It contained a workspace with a plan and
customer ID, a subscription, and an unfinished checkout.

No new migration command was run before launching cloud. The server's startup
migration applied the billing extraction and baseline adoption automatically.
The sign-in endpoint returned HTTP 200 and its page rendered in the browser.
Assertions verified preservation of the plan, customer ID, subscription, and
checkout, as well as removal of the old billing columns from `organization`.
The existing tracking table retained 15 entries (13 original migrations,
billing extraction, and the app baseline marker); the cloud table held one.

The cloud process was stopped and started again against that database. It
returned HTTP 200 again; tracking counts and all seeded records were unchanged.
The disposable server and database were then removed. This checked the current
branch's local cloud startup, not a deployed server or production database.
