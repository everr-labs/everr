# 3: Engine spans

**What to build:** The engine's operations are visible in traces:
scheduler scan, evaluation, the rule query, event processing, group
flush, delivery. Rule syntax errors do not page anyone.

**Details:** step 9 of Order of work, and its decision list, in
`../02-alerting-clickhouse-surface.md`.

**Blocked by:** None; can start immediately.

**Status:** mostly shipped, see the boxes

Most of this landed with `server/alerting/telemetry.ts` and the
`alertJob` wrapper in `server/alerting/runtime.ts`. Two decisions in the
original ticket were taken differently, and the doc records the shipped
answer rather than the plan:

- **Links, not one trace.** Every job is its own root span, linked to
  its enqueuer through a `traceparent` on the job payload. Parenting
  would claim one trace spans the whole chain, which is false: evaluate
  fans out per transition, flush fans out per channel, and a silence can
  defer an event for hours. `everr.alert.episode_id` is what reassembles
  an incident across the traces.
- **`everr.alert.*`, not `everr.feature`.** The shared convention is the
  `everr.` prefix; alerting realises it as its own namespace.

- [x] Spans on the operations: `alerts.jobs.scan`, `.evaluate`,
      `.process_event`, `.flush_group`, `.send_delivery`,
      `.project_lifecycle`, `.retention`
- [ ] A span for the rule query itself. Today the ClickHouse query runs
      inside the `evaluate` span with no child of its own, so query cost
      cannot be separated from evaluation cost
- [ ] The evaluation span carries the ids of the rows it produced.
      `episode_id` and `event_id` are set on `process_event` and
      `flush_group`, never on `evaluate`; the helper already accepts
      both, so this is a call-site gap
- [ ] User-authored SQL errors are classified so they do not set span
      status ERROR. Satisfied by accident, not by design: the query
      failure is caught into `recordAlertEvaluation("query_failed")` and
      never throws out to the span, so nothing sets ERROR. Nothing
      distinguishes a rule syntax error from an infrastructure failure,
      and `classifyCloudQueryError` is not called anywhere in the
      alerting tree
- [x] Trace context propagates through the Graphile job payload, as a
      span link
- [x] Verified with `everr-dev` telemetry: `send_delivery` with
      `rule=demo/demo-flapping` and `outcome=delivered`, `process_event`
      outcomes, `flush_group` batch attributes
