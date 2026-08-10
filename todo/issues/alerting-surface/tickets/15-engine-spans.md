# 15: Engine spans

**What to build:** The engine's operations are visible in traces:
scheduler scan, evaluation, the rule query, event processing, group
flush, delivery. Rule syntax errors do not page anyone.

**Details:** issue 18 in `../03-alerting-surface-plan.md`, and step 9's
decision list in `../02-alerting-clickhouse-surface.md`.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [ ] Spans on all six operations (scheduler scan, per-rule evaluation, the rule query, event processing, group flush, delivery attempt), with the existing everr attribute conventions
- [ ] The evaluation span carries `notification_event_id` and `episode_id`
- [ ] User-authored SQL errors are classified so they do not set span status ERROR
- [ ] Trace context propagates through the Graphile job payload, so enqueue-to-run is one trace
- [ ] Verified with `everr-dev` telemetry
