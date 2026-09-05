# Postgres alerting schema and write-path review

Date: 2026-09-05
Status: proposals for discussion, not approved implementation

## Scope and evidence

The accompanying read fixes narrow instance projections and make latest
notification selection deterministic with `occurred_at DESC, id DESC`. Schema,
migrations, write paths, and application data are unchanged by these fixes.

The two races below were reproduced by interleaving the application's SQL on two
connections to a disposable local Postgres database using the current migrations.
Index measurements used 100,000 synthetic delivery rows. These are local
reproductions, not production measurements. The disposable database was removed.

## 1. Lock the rule before deleting its lifecycle

In `packages/app/src/data/alerting/rules/repository.ts`, `deleteRule` reads the
rule and calls `closeRuleLifecycle` before acquiring a definition row lock.
Evaluation takes that lock before writing transitions.

Reproduced sequence:

1. Delete reads the rule and finds no open instances.
2. Evaluation inserts a firing instance and event, then commits.
3. Delete cancels the event and deletes the rule, cascading the instance away.
4. The journal retains `instance_fired` without `instance_closed`.

Recommendation: add `FOR UPDATE` to the initial definition read, keeping the
same definition-first lock order as evaluation and pause. Add a two-connection
regression test; sequential tests cannot exercise this interleaving.

Discussion: approve as a standalone correctness fix, without a schema change.

## 2. Serialize default-destination replacement

In `packages/app/src/data/alerting/delivery/repository.ts`,
`setDefaultDestination` deletes and inserts inside a transaction. Two replacements
starting with no destination both delete nothing and insert disjoint rows. The
reproduction retained both `all` and `critical`, violating exclusive modes.

Recommendation: lock a stable organization row or acquire a transaction-scoped
advisory lock before replacement. Locking destination rows cannot protect an empty
destination. Automatic assignment in `createChannel` must use the same lock, and
channel creation plus its default assignment should commit atomically.

Discussion: prefer the organization row lock unless contention with unrelated
organization updates justifies an advisory lock. No new table is needed just to
provide serialization.

## 3. Index delivery references used during deletion

`packages/app/src/db/schema/alerts.ts` has no index on
`alert_deliveries.notification_group_id`. Group deletion must locate deliveries
for its foreign key's `SET NULL` action. The equivalent lookup scanned 100,000
synthetic rows to return 100. Adding an index changed it to a bitmap index/heap
scan, approximately 2.7 ms to 0.06 ms locally.

The existing `(organization_id, channel_id)` index covers only in-flight rows.
It serves the delete guard but cannot serve `deleteChannel`'s update of all
references, including settled deliveries. That query can use another index's
organization prefix but must filter that organization's delivery history.

Recommendation: add the group-reference index and evaluate a full organization
and channel index. Decide whether the smaller in-flight index should remain from
representative plans and write cost. Coordinate the group index with item 6.

Postgres does not automatically index referencing foreign-key columns:
[Postgres foreign-key documentation](https://www.postgresql.org/docs/17/ddl-constraints.html#DDL-CONSTRAINTS-FK).

Discussion: approve the group index first. Measure whether the full channel index
should replace or coexist with the partial index.

## 4. Batch instance writes during evaluation

`packages/app/src/server/alerting/evaluation/rule.ts` awaits one upsert per
non-skipped transition while holding the definition lock. A thousand transitions
mean a thousand sequential instance-write calls, before per-event job enqueueing.

Recommendation: use bounded multi-row upserts. Preserve the distinction between
keeping, replacing, and clearing `episode_id`; grouping rows by whether their
episode changes is one option. Keep inactive no-op filtering and transactional
event/job persistence.

Discussion: batch instance writes first and measure statement count and lock
duration. Evaluate job batching separately after checking the worker interface's
transaction and deduplication guarantees. Parallel calls on one transaction are
not a substitute for batching.

## 5. Review event indexes for removal

No application query found in the review requires the specific ordering of:

- `alert_events_org_occurred_idx`
- `alert_events_org_fingerprint_idx`
- `alert_events_org_slug_idx`

These are removal candidates, not proven unused in production. Organization-only
cleanup has other organization-leading indexes. Keep support for lifecycle
cancellation, retention, foreign keys, and latest-per-rule reads.

Recommendation: check external SQL consumers and production index usage over a
representative window, accounting for statistics resets, before removal. Compare
plans and write cost.

Discussion: remove only indexes with no remaining consumer. No blanket removal
or partitioning change is proposed.

## 6. Enforce tenant consistency for delivery groups

The delivery-to-group foreign key checks only the group ID. Surrounding composite
relationships also enforce organization consistency. This is an invariant gap,
not a demonstrated cross-tenant application exploit.

Recommendation: reference `(organization_id, notification_group_id)` against the
existing group uniqueness constraint and use
`ON DELETE SET NULL (notification_group_id)` to preserve the organization.
Postgres 17 supports this column-selective action:
[Postgres foreign-key documentation](https://www.postgresql.org/docs/17/ddl-constraints.html#DDL-CONSTRAINTS-FK).
Check Drizzle's representation before choosing the implementation.

Discussion: approve the invariant with the supporting index from item 3. Retain
the channel in-flight delete guard; selective `SET NULL` alone cannot protect
pending deliveries that still need their channel.

## 7. Extend the latest-notification index for ties

The read fix adds `id DESC`; `alert_events_org_definition_kind_idx` currently
ends at `occurred_at DESC`.

Recommendation: evaluate extending it to
`(organization_id, source_definition_id, kind, occurred_at DESC, id DESC)`.
The query is correct without it, but Postgres may need to sort timestamp ties.
Large evaluations can create many tied rows.

Discussion: compare plans for sparse histories and large tied batches before
accepting the extra index width.

## Proposed order

Fix the deletion and destination races first. Address delivery reference indexes
and tenant consistency together, then batch instance writes. Treat event-index
removal and the latest-notification index extension as measured schema decisions.
Generate no migrations until the schema decisions are agreed.
