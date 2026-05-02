## What

Tenant retention rows are never removed when an org is deleted. Stale entries accumulate in `app.tenant_retention_source` and in the `app.tenant_retention` dictionary.

## Where

- `packages/app/src/lib/auth.server.ts` — retention is seeded in `afterCreateOrganization` but no symmetric cleanup on org deletion.
- `clickhouse/init/10-create-mvs.sql` — `app.tenant_retention_source` (ReplacingMergeTree by `tenant_id`) and the `app.tenant_retention` dictionary.

## Steps to reproduce

1. Create an org → row inserted into `app.tenant_retention_source`.
2. Delete the org in Postgres / via better-auth.
3. Query `app.tenant_retention_source` — the row is still there. Dictionary still serves a retention for that tenant.

## Expected

Org deletion removes (or tombstones) the corresponding retention row so the dictionary no longer holds entries for non-existent tenants.

## Actual

Rows accumulate indefinitely.

## Priority

low

## Notes

- Low-volume today; not a bug, just drift.
- Options: hook into org delete in better-auth and insert a tombstone row (RMT can't delete by version alone — would need lightweight delete or a `deleted` flag filtered out in the dictionary source query), or run a periodic reconciler against Postgres org IDs.
