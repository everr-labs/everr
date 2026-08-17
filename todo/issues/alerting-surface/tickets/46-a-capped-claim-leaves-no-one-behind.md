# 46: A capped claim leaves no one behind

**What to build:** When a flush claims its full cap, the members it did not
reach are flushed next, and the ones it did reach go to the back of the queue.
Demo: put more than `FLUSH_GROUP_MEMBER_CLAIM_CAP` members in one group, all
of them already flushed once, and flush it. Read the group: `next_flush_at` is
a real time, not the year 9999. Flush again: the members the first claim
missed are the ones announced.

**Details:** found 2026-08-11 by the pipeline integration tests
(`pipeline-capacity.integration.test.ts`), which reached the state instead of
reading for it.

Two comments state the intent this ticket restores.
`delivery/flush-group.ts:61-64`: "Whatever is left past the cap stays linked
and unflushed, and the pending count this flush already computes turns that
into an immediate follow-up flush rather than a lost member."
`delivery/grouping.ts:186-188`: "the leftovers of a capped claim and the news
arriving a moment later land in one notification instead of two."

Both hold only while the leftovers are unflushed. The pending count
(`flush-group.ts:362-371`) counts `flushed_at IS NULL`, so a leftover that was
flushed in an earlier round is invisible to it. Two failures follow from that
one predicate.

**The follow-up flush is not armed.** A group with 500 new firing members and
one member flushed earlier claims the 500, because the claim orders unflushed
first (`journal-reader.ts:88-91`). After the flush every row in the group
carries a `flushed_at`, so the pending count is zero. With no
`repeat_interval_seconds` set, `repeatAt` is null too, and
`nextGroupFlushState` has nothing to schedule from: the group parks on
`IDLE_GROUP_FLUSH_AT` and enqueues nothing. The leftover waits for unrelated
new traffic. The park ticket 41 fixed does not cover this one: that fix reads
the sentinel as "no flush booked" only while `last_flushed_at` is null, and it
is set here, so the next arrival does take a real schedule and the group is not
dead. What is lost is
the immediate follow-up, and with it the pruning pass. A membership row leaves
a group only by being claimed once more and then not written back as active
(`journal-reader.ts:49-53`), so a row belonging to a deactivated rule stays
linked, and keeps consuming a claim slot on every later flush.

**Members past the cap never repeat.** When every member is already flushed,
the claim falls through to `asc(alertEvents.id)`. The written-back rows keep
their event ids, so the same oldest members win every claim, and everything
past the cap is announced once and never repeated. The unflushed-first
ordering was added for this starvation and cures only the unflushed half of
it.

**Shape:** two changes, both small.

Arm the follow-up from the claim, not from the pending count: the flush
already knows whether `rows.length` reached the cap, and that fact alone means
work is left. Pass it beside `hasUnflushedMembers`, or fold the two into one
"more to do" input.

Rotate the claim order: after `flushed_at IS NOT NULL`, order by `flushed_at`
ascending before the event id. The oldest announcement goes first, the members
just written back go to the back, and the leftovers of a capped claim lead the
next one.

**Rejected: raising the cap.** The cap exists so one storm cannot push a
worker through an unbounded suppression walk. A higher number moves the
boundary and keeps the behaviour at it.

**Rejected: stamping the leftovers unflushed.** It would arm the follow-up
through the existing count, and it would also make a member that has been
announced look like one that has not, which is the fact the rest of the flush
reads to decide what to say.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] A flush that claims its full cap schedules a follow-up flush, whatever
      the leftovers' flush state
- [ ] A group larger than the cap repeats every member, not the same oldest
      cap-worth
- [ ] A membership row belonging to a deactivated rule is pruned without
      waiting for unrelated traffic
- [ ] `pipeline-capacity.integration.test.ts` case 3 asserts the follow-up
      schedule instead of the idle sentinel
