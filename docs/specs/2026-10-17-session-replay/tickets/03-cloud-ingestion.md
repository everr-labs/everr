# 03: Cloud ingestion for Clips

**What to build:** In the Cloud, Segments (event name `everr.browser.recording.segment`) are split off after the usage processor and stored in `app.recordings` with the Plan retention, isolated per tenant and invisible to the SQL API. Ordinary logs are unaffected.

**Blocked by:** None (can start immediately)

**Complexity:** high

**Verify:** `(cd collector && make test-all) && pnpm --filter @everr/app test:ci && pnpm --filter @everr/app typecheck`

**Status:** ready-for-agent

- [ ] `routingconnector` added to the collector build; the Cloud pipeline routes by event name after the usage processor, so a Segment is counted once
- [ ] Recordings exporter with a small item-count batch (about 16) and about a 1 second flush
- [ ] `otel.otel_recordings` (`ENGINE = Null`, same columns as `otel.otel_logs`), `app.recordings_mv` stamping `tenant_id` and `retention_days` and projecting `session_id`, `stream_id`, `clip_id`
- [ ] `app.recordings`: `app.logs` columns plus the three ids, ZSTD body, `ORDER BY (tenant_id, ServiceName, Timestamp)`, partition by day and retention with `ttl_only_drop_parts = 1`, bloom filters on the three ids
- [ ] Row policies mirrored from `tenant_filter_logs` and `sql_api_default_deny_logs`; not granted to the SQL API role; not in the SQL API tenant table list
- [ ] Negative assertions: `recordings` is not in `SQL_API_TENANT_TABLES` and not in the MCP query tool description
- [ ] Manual DDL for existing clusters written down next to the init scripts
- [ ] Exporter integration test on testcontainers covers OTLP in, rows out through the MV with stamped tenant and retention
