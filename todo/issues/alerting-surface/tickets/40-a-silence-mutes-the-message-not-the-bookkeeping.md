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
change should reach the group either way. Two candidate routes, and the
choice is the work:

- The resolve joins the group as it normally would, and the flush declines to
  announce it. The membership bookkeeping then runs unchanged, which is the
  smaller behavioural change.
- Suppression keeps consuming the resolve, but removes the instance's
  membership as it does so. This is narrower but leaves the two concerns
  entangled.

Whichever wins, the terminal on the resolve's own chain must stay exactly
one row.

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
