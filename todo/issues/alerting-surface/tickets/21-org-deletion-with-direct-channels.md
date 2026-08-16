# 21: Organization deletion with direct rule channels

**What to build:** Deleting an organization succeeds even when a rule maps
directly to a channel. Today the foreign key ordering makes PostgreSQL
reject the cleanup and roll it back.

**Details:** finding 9 in `../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** done

**Progress (2026-08-16):** The ordering shipped and is pinned by the cleanup unit test. The remaining box stays open as a follow-up: a real-database harness now exists (`testing/pglite-database.ts`), so the organization-cleanup case is writable where it was not before.

- [x] Cleanup ordering handles direct rule-to-channel mappings
- [ ] An organization cleanup integration test with direct rule channels

Record check 2026-08-10: the ordering fix is in
`organization-data-cleanup.server.ts` with the constraint stated in a comment.
The existing test asserts delete ordering against mocks; no test exercises the
real foreign keys.
