# 40: A silence mutes the message, not the bookkeeping

**What to build:** A silence stops a notification going out. It must not stop
the pipeline from learning that an instance ended. Demo: silence a firing
alert from the triage board, let the condition clear while the silence is
still open, and read the instance's chain. Its terminal names the silence,
not `no_longer_firing`, and its membership left the notification group when
the condition cleared.

**Details:** found 2026-08-11, while verifying why a notification group can
carry an instance that is not firing.

`deferSuppressedEvent` treats a silenced fire and a silenced resolve
differently, and the difference is not documented anywhere. A fire is
deferred: `processed_at` goes back to null and the event is re-queued for
when the silence lapses, so nothing is lost. A resolve is terminated:
`shouldRetry` is false for `instance_resolved`, so the event is stamped
processed, a terminal is journaled, and the event is gone.

Terminating the resolve is right for the notification. Nobody wants to hear
that something recovered while they asked not to hear about it. It is wrong
for the bookkeeping, because the resolve is also the only message that
removes the fire from its notification group. The group keeps a membership
that means "a fire arrived and no resolve has come since", and the swallowed
resolve makes that sentence permanently false.

This is easy to reach. `alertingSourceScopedSilenceMatchers` seeds a silence
from the instance's labels plus `rule`, with no `status` matcher, so a
one-click silence from the triage board always matches the resolve as well as
the fire.

**This is smaller than it was.** `memberVerdict` now re-checks live instance
state at flush time, so a member whose instance has stopped firing is dropped
before it can be announced. That removes the whole user-visible harm: no
phantom line in a notification, no repeat page for an instance that ended.
What is left is not urgent, and this ticket should be read as hygiene:

- The terminal on the dropped member reads `no_longer_firing`, when the truth
  is that its resolve was silenced. A reader cannot tell the two apart.
- The membership row survives until that group's next flush, which may be far
  away if the group goes idle. It is a leaked row, not a wrong notification.
- The conflation itself stays: nothing in the code says whether suppression
  governs the message only or the state as well, so the next feature that
  reads group membership inherits the same trap.

**Shape:** the decision to suppress belongs to the notification, so the state
change reaches the group either way. The resolve joins its group as any other
event does, and the flush declines to announce it. Five edits over four
files:

- `processAlertEvent` defers only fires. A silenced resolve falls through to
  the normal dispatch path.
- The same function clears `silence_id` before dispatch. It must keep it on a
  resolve: that stamp is how the flush knows not to announce it.
- `flushAlertGroup` runs its own silence check over every claimed member, and
  a silenced resolve matches there too (the triage silence carries no
  `status` matcher, so `status=resolved` does not save it). That check must
  skip resolves, or it defers the event straight back out of the group and
  undoes the fix. The rule lives in two places and both must agree.
- `groupNotificationPlan` sends a silenced resolve to `droppedUnannounced`
  rather than `notify`. That branch was built for this idea already: end the
  chain, announce nothing. The resolve still supersedes the fire in
  `latestByInstance`, so the membership is dropped with no extra work.
- The terminal carries the event's own `silenced` and `silence_id`, so the
  chain says the resolve was silenced instead of `no_longer_firing`.

The care is not in the code, it is in the invariant. Exactly one writer owns
a chain's terminal, guarded through `processed_at`. Today a silenced
resolve's terminal is owned by `deferSuppressedEvent`; after this it is owned
by the flush. A wrong handover writes two terminals or none, and neither
shows up without a test that looks for it.

**Rejected: letting suppression delete the membership as it consumes the
resolve.** It is the smaller change and it does not work. The flush claims
membership rows, then re-inserts the still-active ones when it commits, so a
delete that lands between those two points is undone and the fire comes
straight back. Removal has to happen inside the flush's own locked
transaction, which is where every other member already leaves the group.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] A silence that covers a firing instance also covers its recovery: no
      notification goes out for either
- [ ] The instance's membership leaves its notification group when the
      condition clears, silence open or not
- [ ] A chain ended by a silenced resolve says so, and is not reported as
      `no_longer_firing`
- [ ] The resolve's chain still ends in exactly one terminal
- [ ] The reference states that suppression governs notification only, and
      never the state a group is built from
