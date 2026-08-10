# 21: Organization deletion with direct rule channels

**What to build:** Deleting an organization succeeds even when a rule maps
directly to a channel. Today the foreign key ordering makes PostgreSQL
reject the cleanup and roll it back.

**Details:** finding 9 in `../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [ ] Cleanup ordering handles direct rule-to-channel mappings
- [ ] An organization cleanup integration test with direct rule channels
