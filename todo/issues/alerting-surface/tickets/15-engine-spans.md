# 15: Engine spans

**What to build:** The engine's operations are visible in traces:
scheduler scan, evaluation, the rule query, event processing, group
flush, delivery. Rule syntax errors do not page anyone.

**Details:** step 9 of Order of work, and its decision list, in `../02-alerting-clickhouse-surface.md`.
Mirror the `everr.feature` attribute naming from
`routes/api/cli/sql.ts`, and classify rule syntax errors through
`classifyCloudQueryError` so they do not page.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [ ] Spans on all six operations (scheduler scan, per-rule evaluation, the rule query, event processing, group flush, delivery attempt), with the existing everr attribute conventions
- [ ] The evaluation span carries `notification_event_id` and `episode_id`
- [ ] User-authored SQL errors are classified so they do not set span status ERROR
- [ ] Trace context propagates through the Graphile job payload, so enqueue-to-run is one trace
- [ ] Verified with `everr-dev` telemetry
