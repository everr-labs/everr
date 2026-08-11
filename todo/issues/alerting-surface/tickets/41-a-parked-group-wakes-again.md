# 41: A parked notification group can be woken again

**What to build:** A notification group that parked before it ever flushed
takes a real schedule when the next event reaches it, instead of keeping the
idle sentinel. Demo: put a group on the sentinel with `last_flushed_at` still
null, dispatch an event to it, and read `next_flush_at`: it is one group wait
away, not in the year 9999.

**Details:** found 2026-08-11 during the branch review, by reading the flush
scheduler rather than by hitting it.

`nextGroupFlushAt` (`delivery/grouping.ts`) returns `existing.nextFlushAt`
unchanged when `last_flushed_at` is null. That branch exists for a good
reason: a group whose first flush is already booked must not have it
postponed by later arrivals. It does not separate "a first flush is booked"
from "this group parked on `IDLE_GROUP_FLUSH_AT`", and the sentinel is the
year 9999. A group in that state keeps it forever: every later dispatch reads
the sentinel, writes it back, and enqueues the flush job with `run_at` in
9999. The group never notifies again, and nothing says so.

The only park that leaves `last_flushed_at` null is the empty-claim branch in
`flushAlertGroup`: a flush that is due and claims no member parks on the
sentinel without stamping the column. That state is not reachable on the
current code. It needs every member's journal row to be gone by the time the
flush runs, and `alert_events` has no foreign key to the definition, so
neither a pause nor a delete removes them. Organization deletion removes
them, and takes the group with it.

So this is latent, not live. It is filed because the guard is one line and
the failure is silent and permanent: a receiver group that has stopped
notifying looks exactly like a receiver nobody routes to.

**Shape:** teach `nextGroupFlushAt` that the sentinel is the absence of a
schedule, and return `now + group_wait` for it, the same answer it gives for
a group it has never seen. A new arrival at a parked group is a first
arrival, and it should wait what a first arrival waits.

**Rejected: stamping `last_flushed_at` in the empty-claim park.** It is
truthful, a flush did run, and it would hand the existing
`min(next, max(now, last + interval))` branch something to work with. It also
makes the first event after a park wait a full group interval instead of the
group wait, which is the wrong answer for a group that has notified nobody.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] A group parked on the idle sentinel takes a new schedule when an event
      is dispatched to it
- [ ] A group whose first flush is still booked does not have it postponed
- [ ] The parked-and-never-flushed case has a test; no test reaches it today
