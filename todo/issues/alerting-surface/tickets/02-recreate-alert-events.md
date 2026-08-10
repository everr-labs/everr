# 02: Recreate app.alert_events in its final shape

**What to build:** The history table lands in its final, immutable shape,
and the engine writes it. One commit: the DDL, UUIDv7 ids, and the row
builders, because the builders must match the DDL when it lands. Demo: a
dev alert fires, the row lands with the new shape, and the chain query
with its derived time bound returns the whole notification.

**Details:** issues 2, 3 and 4 in `../03-alerting-surface-plan.md`, and
The table recreation in `../02-alerting-clickhouse-surface.md`.

**Blocked by:** 01 (the terminal event type name is in the DDL).

**Status:** ready-for-agent

- [ ] Composite partition key on `(month, evaluation-or-not)`; `event_date` dropped; no set index
- [ ] Column changes per The table recreation and the recreation findings, including the reserved inhibition-freeze columns
- [ ] `episode_id` per Episodes and chain membership: the opening event's id on lifecycle rows, zero elsewhere
- [ ] `context_json` frozen at write time: summary, description, runbook and alert links, condition summary; labels and matcher values take a hard length cap at the write boundary
- [ ] Codecs and the split TTL (evaluations at 30 days, the rest at tenant retention)
- [ ] `event_id` is UUIDv7 from both the builders and the column default on non-delivery rows; delivery rows take deterministic ids derived from the journal event and the delivery key, per the `event_id` row in the doc's Reference
- [ ] The narrowed `app.logs` projection: fired and resolved only, live rows only, `ServiceName` resolved at write time, `everr.signal = 'alert'`
- [ ] The `error` column is sanitized at the write boundary; no URLs or tokens
- [ ] A migration for existing deployments, every statement with its own `SETTINGS`
- [ ] Ingestion verified with `everr-dev`
