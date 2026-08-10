# 04: cloud query access to alert history

**What to build:** `everr cloud query` can read `app.alert_events`. Today
the surface's one intended caller gets a permission error. This is the
tenancy template every future alerting object copies. Demo: a query as an
organization returns only that organization's rows.

**Details:** issue 6 in `../03-alerting-surface-plan.md`; blocker 2 in the
design doc's findings.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] SELECT grant for the SQL API role on the table
- [ ] Default-deny policy plus per-organization row policy
- [ ] Provisioning code creates the policy for new organizations
- [ ] Verified with `everr-dev cloud query`: own rows visible, other tenants' rows absent
- [ ] Documented as the copyable tenancy template
