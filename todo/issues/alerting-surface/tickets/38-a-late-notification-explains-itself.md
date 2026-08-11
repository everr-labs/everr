# 38: A late notification explains itself

**What to build:** A reader looking at an alert can tell why its
notification arrived when it did. Demo: an alert that fired at 11:42 and
notified at 11:44 says which timing value held it and when its group last
notified, without a SQL query or a look at `routing/defaults.ts`.

**Details:** found 2026-08-11. Reconstructing one 2m25s delay on
`demo/demo-flapping` took the `alert_events` history, a direct read of
`alert_notification_groups` in PostgreSQL for `last_flushed_at`, and the
default table in `routing/defaults.ts`. Only the first of those three is
available to a user. The delay itself was ordinary group throttling, working
as designed; what was missing was any way to see that from the product.

The gap is worth closing because the two ordinary answers look identical from
outside. "The engine was slow to notice" and "the group was throttling" both
present as a notification that arrived late, and they call for opposite
responses: the first is an incident, the second is a setting. Today the
history surface can separate them and the UI cannot.

The numbers are not small. Over four hours on that one rule a fire waited a
median of 138.2s while a resolve waited 19.2s, because a resolve arrives when
a repeat tick is already booked and `nextGroupFlushAt` takes the earlier of
that and the group interval floor. A fire has no tick waiting for it and pays
the full remaining interval. That asymmetry is invisible everywhere in the
product.

This belongs on the alert or notification surface, not on the delivery
configuration page. Ticket 37 covers the separate problem that a route row
misstates its own timing.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [ ] A notification carries the time its transition occurred and the time it
      was sent, so the delay is visible rather than inferred
- [ ] The reason for the delay is named: group wait, group interval, repeat,
      or a delivery retry
- [ ] Detection lag and notification throttling read as different things
- [ ] Nothing here requires a SQL query or a source file to interpret
