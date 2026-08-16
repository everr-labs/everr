# 04: cloud query access to alert history

**What to build:** `everr cloud query` can read `app.alert_events`. Today
the surface's one intended caller gets a permission error. This is the
tenancy template every future alerting object copies. Demo: a query as an
organization returns only that organization's rows.

**Details:** issue 6 in `../03-alerting-surface-plan.md`; blocker 2 in the
design doc's findings.

**Blocked by:** 02.

**Status:** done

- [x] SELECT grant for the SQL API role on the table
- [x] Default-deny policy plus per-organization row policy
- [x] Provisioning code creates the policy for new organizations
- [x] Verified with `everr-dev cloud query`: own rows visible, other tenants' rows absent
- [x] Documented as the copyable tenancy template

Record check 2026-08-10: the code side is complete (`15-create-sql-api-role.sql`,
`provisionSqlApiOrgUser`, `sql-api-tables.ts`). Open: the live query check, and
the backfill migration's manual second step for pre-existing organizations.
