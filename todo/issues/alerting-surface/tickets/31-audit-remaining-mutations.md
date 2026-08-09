# 31: Audit the remaining alerting mutations

**What to build:** The audit journal widens from suppression-affecting
mutations to every alerting configuration mutation: channel and receiver
create/change/delete, and plain rule applies. Ticket 17 deliberately
narrowed its scope (decided 2026-08-09); this ticket is the declared
follow-up, so "who added this webhook" becomes answerable.

**Details:** step 10 in `../02-alerting-clickhouse-surface.md`
(Auditability stays in PostgreSQL); the scope decision is recorded in its
settled list.

**Blocked by:** 17.

**Status:** ready-for-agent

- [ ] Channel, receiver, and rule-apply mutations journal audit rows through the same enforcement boundary as ticket 17
- [ ] Snapshots go through the same typed per-channel-type redaction
- [ ] The application trail displays the widened set
