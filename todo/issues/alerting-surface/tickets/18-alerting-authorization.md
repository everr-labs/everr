# 18: Alerting administration requires a permission

**What to build:** A regular organization member can no longer replace
webhooks, rewrite routes, create a catch-all silence, or pause
monitoring. Alerting administration requires a defined role, enforced on
the server.

**Details:** finding 4 in `../04-alerting-branch-review.md`.

**Blocked by:** A real RBAC model. Deferred out of the merge gate
(2026-08-09): the product has no proper role-based permission system yet
beyond the better-auth owner/admin/member roles, and alerting should not
invent one alone. Accepted risk until this lands: any organization member
can replace webhooks, rewrite routes, create a catch-all silence, or
pause monitoring.

**Status:** deferred

- [ ] The role or permission for alerting administration is defined
- [ ] Enforced on channels, channel tests, receivers, routes, inhibitions, silences, and rule mutations
- [ ] Server-side authorization coverage; UI visibility is not sufficient
