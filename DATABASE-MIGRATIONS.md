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

## Verification

Use separate disposable PostgreSQL databases before changing an existing
installation. Check fresh and repeated App startup against the App database,
fresh and repeated Cloud startup against the Cloud database, and preservation of
each product's data.
