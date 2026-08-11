# 36: The flush tests exercise the real claim

**What to build:** A defect in what a flush claims fails a test. Demo: revert
the claim ordering in `deliverableGroupMemberQuery` and watch a
`flush-group` test go red, without hand-writing the member list the query
would have returned.

**Details:** found 2026-08-11. The starvation bug lived in the claim query
and survived a full suite because no test ran that query against data.
`flush-group.test.ts` mocks `./journal-reader` outright and feeds
`mocks.memberRows` straight in, so the flush is tested against an assumed
claim rather than the real one. `journal-reader.test.ts` does render the
real SQL through a detached `QueryBuilder`, which is the right idea, but it
asserts only the `kind = 'notifying'` filter, the liveness join, and now the
ordering. Anything the query gets wrong that those three assertions do not
name is invisible.

The two halves that must meet are: which rows the query returns for a given
membership state, and what the flush does with them. Both are tested; the
join between them is not.

**Shape:** the boundary is small and the data is simple (memberships, events,
a definition), so a test that runs the real query against a real PostgreSQL
is the direct answer. If that is too heavy for this suite, the alternative is
a fake that derives its rows from the query's own ordering and cap rather
than from a hand-written list, so a change to either shows up.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] A group above the claim cap, whose oldest members are all still firing, delivers its newest members
- [ ] That test fails when the claim orders on the event id alone
- [ ] The flush no longer asserts against a hand-written member list where the ordering is what matters
