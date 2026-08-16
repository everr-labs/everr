# Alerting surface: the plan and what is left

The design authority is
[`02-alerting-clickhouse-surface.md`](02-alerting-clickhouse-surface.md).
When this file and the doc disagree, fix the doc first.

What already shipped is described in
[`05-what-shipped.md`](05-what-shipped.md), not here. The executable
tickets for what is left live in [`tickets/`](tickets/), one file per
ticket with its blockers. Work any ticket whose blockers are all done.

Ticket numbers are stable. They are cited by code comments and by
PR #343, so a number is never reused or renumbered, and the sequence has
gaps where completed tickets were removed on 2026-08-16.

## Merge gate: met

The gate decided on 2026-08-09 was tickets 01, 02, 03, 04, 05, 12, 13,
20, 21 and 22. All are done, with 11 and 16 alongside them. See
[`05-what-shipped.md`](05-what-shipped.md).

Two review P1s were deliberately left outside the gate, each with its
risk stated in its ticket: 18 (alerting authorization) waits for a real
RBAC model, and 19 (SSRF-safe webhook delivery) is a non-blocking
follow-up. Merging ships both risks knowingly.

## What is left

Phase 1 was the one-way doors and the front door: the final table shape,
the row builders, the migration riders, tenancy and the skill file. It is
done. Phase 2 is additive. No ticket in it needs a migration or a table
recreation. Until it lands, the surface is best effort rather than
durable, and an absent row means unknown.

The 28 open tickets group into six arcs. The first three are the ones
that finish the design; the last three are hardening and the batch the
integration suite turned up.

### Arc A: durability (06, 07, 08)

The reconciler that makes a dropped insert a delay instead of a permanent
hole, the delivery diff and sweep beside it, and the counters that say
whether the primary path is rotting. The table's
`non_replicated_deduplication_window` is already sized for this arc, and
the live insert path already carries its deduplication token, so the
schema is committed to a reconciler that does not exist yet.

### Arc B: the vocabulary gets its writers (09, 10, 14)

`hold_changed` sits in the event-type enum and in a CHECK constraint with
nothing writing it, and `notification_deferred` appears nowhere in the
source. This arc gives them writers, with the silence and inhibition
freezes, and adds `app.alert_state`. Until it lands, the schema promises
rows that do not exist.

### Arc C: attribution and observability (15, 17, 31)

The engine has no spans and no counters, so no operational question about
it has an answer. Ticket 16 already put the actor where the audit journal
needs it, so 17 is unblocked, and 31 extends it to the remaining
mutations.

### Arc D: delivery hardening (23, 28, 29, 30)

Per-recipient delivery state, the alert and runbook links reaching a
notification, bounded recipients and error bodies, and the terminal
failure state that retention needs. Each ticket records which half is
already in place.

### Arc E: deferred by decision (18, 19)

Authorization waits for a real RBAC model. SSRF-safe webhook delivery is
a non-blocking follow-up. Both ship as accepted risks.

### Arc F: found by the integration suite (34 to 47, minus 45)

Thirteen tickets filed while building and testing the pipeline, none of
them fixed. Tickets 39 and 41 already have characterization cases that
pin today's answer, so whoever lands the fix flips the expectation rather
than writing the case. 46 and 47 came out of the read of the flush claim
and the routing lookup.

Each ticket carries its own detail and points at the design doc for the
step it implements. Nothing here duplicates a ticket.
