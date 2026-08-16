# 25: Rule polling survives pagination

**What to build:** Organizations with more than one page of rules keep
receiving live list updates instead of polling silently stopping.

**Details:** finding 15 in `../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** done

- [x] Paginated rule data refreshes without silently disabling updates
- [x] Coverage for an organization with at least two pages
