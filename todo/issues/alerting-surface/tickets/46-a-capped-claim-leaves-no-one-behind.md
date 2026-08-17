# 46: A capped claim leaves no one behind

**What to build:** A group larger than one flush's claim cap repeats every
member, not the same oldest cap-worth. Demo: put more than
`FLUSH_GROUP_MEMBER_CLAIM_CAP` members in one group under a route with a
repeat interval, all of them already flushed once, and let two repeats come
due. The second repeat announces the members the first one did not reach.

**Details:** found 2026-08-11 by the pipeline integration tests
(`pipeline-capacity.integration.test.ts`), which reached the state instead of
reading for it. Rewritten 2026-08-17: the first read of this ticket proposed
two changes, and one of them would have sent pages nobody asked for. That
shape is under Rejected, with the evidence, so it is not proposed again.

## The machinery

`alert_notification_group_events` links a journal event to a group and carries
`flushed_at`: null means never announced, a timestamp means announced then.
One flush claims up to `FLUSH_GROUP_MEMBER_CLAIM_CAP` (500,
`delivery/flush-group.ts:60`) of those rows, decides what each deserves,
deletes every claimed row, and re-inserts the still-active ones stamped with
this flush's time.

Two properties carry the rest of this ticket. The cap exists so one storm
cannot push a worker through an unbounded suppression walk. And claiming is
the only way a row leaves a group: a member stops being a member by being
claimed and then not written back (`delivery/journal-reader.ts:49-53`). The
claim is therefore both the announcement path and the pruning path.

## What is broken: members past the cap never repeat

The claim orders unflushed first, then by event id
(`journal-reader.ts:89-91`). Once a large group has notified once, every row
carries a `flushed_at`, so the first sort term is equal for all of them and
the order falls through to `asc(alertEvents.id)`. The write-back preserves
each row's event id. The same oldest 500 therefore win every claim, on every
flush, for as long as the group stays oversized. Members past the cap are
announced exactly once, while they were still unflushed and the
unflushed-first rule carried them, and never again.

If those instances are still firing when the repeat interval comes due, no
repeat goes out for them, and the group looks healthy while under-reporting.

Worth reading twice: the unflushed-first ordering was added for this exact
starvation, and its own comment says so. It cures the unflushed half. Steady
state for a large group is the flushed half.

## What is not broken, and why the first read said it was

The first read also claimed the follow-up flush is not armed: the pending
count (`flush-group.ts:356-364`) counts `flushed_at IS NULL`, so leftovers
that were already announced are invisible to it, the count reads zero, and
with no `repeat_interval_seconds` the group parks on `IDLE_GROUP_FLUSH_AT`.

That sequence is real. What it costs is not.

A capped claim that leaves unflushed rows behind is already armed correctly
today, because the pending count sees them. The only way the count reads zero
is when every leftover was already announced. A leftover that was already
announced, under a route that configured no repeat, never needs announcing
again. So no notification is lost.

What is lost is the pruning pass. A membership row belonging to a paused or
deleted rule that sits past the cap keeps its claim slot, because claiming is
the only way a row leaves. That is a leaked row and a wasted slot, not a
missed page, and it should be fixed where leaks are fixed.

## Shape

**Rotate the claim.** After the `flushed_at IS NOT NULL` term in
`deliverableGroupMemberQuery`, order by `flushed_at` ascending before the
event id. The oldest announcement goes first, the rows this flush just wrote
back go to the back, and the leftovers of a capped claim lead the next claim.
Nothing else changes: with a repeat interval set, `repeatAt` already schedules
the next flush (`flush-group.ts:365`), so each repeat cycle now announces a
different slice instead of the same one.

The cost is the same order as today. There is no index on `flushed_at`
(`db/schema/alerts.ts:619-631`), but the claim already sorts on the
`flushed_at IS NOT NULL` expression plus the id, so the plan class does not
change, and a group's membership is bounded by the 1000-row result cap on one
rule's evaluation.

**Prune the leaked row in the maintenance sweep.**
`cleanupAlertingHistory` already walks `alert_notification_group_events` and
already deletes idle groups with no membership
(`maintenance/cleanup.ts:161-173`). A membership whose definition is gone or
paused belongs in the same pass, on the same batch and budget loop. It must
not be done by scheduling a flush: see below.

## Rejected: arming the follow-up flush from the claim

This was the first read's other change, and it would regress into unrequested
pages. `groupNotificationPlan` (`delivery/grouping.ts:84-85`):

```ts
const hasUnflushed = members.some((member) => member.flushedAt === null);
const announced = hasUnflushed ? latest.map(([, event]) => event) : active;
```

When every claimed member is already flushed, the plan announces `active`,
which is every member still firing. That is the repeat path, and it sends a
real notification.

So passing `rows.length >= cap` into `hasUnflushedMembers`
(`flush-group.ts:372`) makes an oversized group schedule a flush one group
interval out, claim 500 already-flushed members, page, and re-arm. For as
long as the rule stays above the cap. A route that sets no
`repeat_interval_secs`, which means "tell me once", would page every 300
seconds. Today's park is wrong and silent; that would be wrong and loud, which
is worse for an alerting product.

The general rule this leaves behind: the flush is the announcement path, so a
follow-up flush may only be armed when something needs announcing. Pruning is
not a reason to announce.

## Rejected: raising the cap

The cap exists so one storm cannot push a worker through an unbounded
suppression walk. A higher number moves the boundary and keeps the behaviour
at it.

## Rejected: stamping the leftovers unflushed

It would arm the follow-up through the count that exists today, and it would
also make a member that has been announced look like one that has not, which
is the fact the rest of the flush reads to decide what to say.

## What this does not fix

Both belong to ticket 35, and they are why 46 improves correctness while
making an oversized group's pages harder to read until 35 lands.

- **The repeat interval stretches, silently.** A group of N members repeats a
  given member every `ceil(N / cap)` cycles. At 5000 members with a one hour
  repeat, that is ten hours per member. Nothing in the product says so.
- **Consecutive pages become different subsets with no marker.** The
  "…and N more" line counts what the flush claimed, never what it could not
  claim. Today an oversized group at least sends the same stable 500; after
  the rotation it sends a rolling window, which reads like the alert set is
  churning.

**Blocked by:** None. Pair with 35 if the pages have to read correctly as
well as cover everyone.

**Status:** ready-for-agent

- [ ] A group larger than the cap repeats every member across successive
      cycles, not the same oldest cap-worth
- [ ] A membership row belonging to a deactivated rule is pruned without
      waiting for unrelated traffic, and without a flush that announces
- [ ] No flush is armed for a group with nothing to announce: a route that
      configured no repeat interval stays silent whatever the group's size
- [ ] `pipeline-capacity.integration.test.ts` case 3 keeps pinning the idle
      sentinel, and its comment stops promising a follow-up schedule that this
      ticket no longer proposes
