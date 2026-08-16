# 47: Routing asks twice for the receiver it already has

**What to build:** Dispatch resolves a route's receiver once. Demo: dispatch an
event that matches 12 routes and count the queries: routing reads the routes
and their receivers together, and does not run one more SELECT per matched
route.

**Details:** found 2026-08-11 while reviewing the routing integration tests.

`loadRoutes` (`delivery/targeting.ts:43-56`) inner-joins `alert_routes` to
`alert_receivers` on the receiver id, and keeps only the receiver's name. The
dispatch loop (`targeting.ts:110-121`) then runs one more SELECT for each
matched route, looking the receiver up again by organization and name, to get
back the row the join already held. The trip is id to name to id.

The second lookup can never miss, and can never find a different row.
`alert_routes` carries a composite foreign key on
`(organization_id, receiver_id)` into `(organization_id, id)`
(`db/schema/alerts.ts:513-517`), so a route's receiver is always in the route's
own organization. `alert_receivers` carries a unique index on
`(organization_id, name)` (`alerts.ts:458-461`), so that organization holds one
receiver with that name. The name being looked up came from that same row. So
`if (!receiver) continue;` (`targeting.ts:121`) cannot run.

Two costs. The guard is dead code that reads as a live safety net, and the
routing tests cannot pin it: a test that removes the receiver row loses the
route at the join instead, one step earlier. And every matched route adds a
round trip to the dispatch path, for each event. A rule matched by 12 routes
pays 12 of them, and a storm multiplies that by the events.

**Shape:** carry the receiver id through `loadRoutes` beside the name, and use
it in the loop. The name is still needed, because `alertingSelectRoutes` and
the route config speak in names, so keep both on the loaded route and drop the
second query with its guard.

**Rejected: keeping the guard as defence in depth.** A guard that the schema
makes unreachable does not defend anything, and it costs a query per route to
stand there. If the uniqueness of the name is ever relaxed, the join is the
place that has to answer for it, not a second lookup that would then silently
pick a different receiver than the route names.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] Routing runs no per-route receiver query
- [ ] The unreachable `!receiver` guard is gone, not just bypassed
- [ ] Route selection and grouping still resolve by the receiver the route
      points to, and the routing integration tests still pass
