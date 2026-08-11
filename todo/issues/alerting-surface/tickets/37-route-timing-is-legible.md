# 37: The route row does not misstate its timing

**What to build:** A route row in the delivery list cannot suggest a timing
the route does not have. Demo: a route that sets only `repeat_interval_secs`
shows the group interval that governs it too, not the repeat alone.

**Details:** found 2026-08-11 while reconstructing a real notification delay
in the dev environment.

`demo/demo-flapping` fired at 11:42:13.659 and the notification arrived at
11:44:38.342, 2m25s later. Detection was not slow: the rule has `for: 0`, so
it fired on its own evaluation tick. The whole delay was `group_interval`.
The group had last notified at 11:39:36.745 (the previous cycle's recovery),
and `nextGroupFlushAt` schedules the next flush at
`max(now, last_flushed_at + group_interval)`. With the default 300s that is
11:44:36.745, and the flush committed 1.6s later.

The route behind it sets only `repeat_interval_secs: 60`. Everything else is
null, so `group_interval_secs` falls back to the 300s default in
`routing/defaults.ts`. The list row in `alerts/delivery.tsx` renders
`alertingRouteTimingSummary(..., "overrides")` and therefore reads
`repeat 60s`. The 300s that governed the delay is on screen nowhere, and the
row invites the reader to conclude the group notifies every 60s.

This overturns a decision rather than fixing a slip. The line above that call
reads `// Routes using default timing stay on one line.`, and keeping the
list compact for routes that customize nothing is a fair goal. The tension to
resolve is a compact list against a row that misstates the route. The route
editor already renders the `"effective"` form in its Notification timing
disclosure, so the wording exists; what is missing is a list treatment that
stays short while not reading as the whole truth.

Not covered here: explaining a specific late notification (ticket 38), and
whether this route's timing is itself a mistake (ticket 39).

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [ ] A route that overrides some timing fields does not read as if the rest
      are unset
- [ ] A route that overrides nothing still fits the compact one-line form
- [ ] The chosen treatment is stated as a decision about the list, so the
      next reader does not undo it as an oversight
