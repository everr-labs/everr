# 33: The `for` clock does not count an outage as holding

**What to build:** A rule with a `for` window does not fire on the first
evaluation after the engine stops and restarts. `for` promises the condition
held continuously, so a stretch nothing watched has to restart the clock.

**Details:** `advanceAlertInstance` measured the `for` window as wall clock
between `pendingSince` and `evaluatedAt`, and nothing checked that the
condition was ever seen holding across it. Only a real evaluation records an
absence, so an outage leaves `absentCount` at 0 and `lastSeenAt` frozen: on
resume the instance looks like it never lapsed, `pendingSince` survives, and
any outage longer than `for` fires the rule immediately.

Caught by `demo/demo-always-pending`, the demo rule built never to fire. In
the dev environment on 2026-08-10 it fired at 17:19:19 with `active_since`
12:16:44. The evaluation history shows no evaluations at all between those
two times, and the samples either side show the value dropping to 0 every
fifth minute exactly as designed. The rule notified, carrying its own
"file a bug against the engine's state machine" text.

The state machine now treats a gap since `lastSeenAt` longer than two
evaluation intervals as unobserved and restarts the pending clock. One
missed tick is tolerated, because schedulers jitter and a single late
evaluation is not evidence the condition lapsed.

Not covered here: an instance already `firing` when an outage starts stays
firing, since nothing observed it recover. That is the safe direction, but
it means an instance that fired through this bug never self-heals, because
`resolveAfter` counts consecutive misses. The stale dev instance was closed
with a pause and resume.

**Blocked by:** None.

**Status:** done

- [x] An evaluation gap longer than the cadence restarts the pending clock
- [x] A rule on cadence still fires at its `for` window
- [x] The demo rule holds pending across cycles again
