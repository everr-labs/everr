-- Settings profile: hard caps for the /sql API. All READONLY so per-query
-- SETTINGS ... clauses cannot loosen them.
CREATE SETTINGS PROFILE IF NOT EXISTS sql_api_profile SETTINGS
  -- Read-only mode. 1 = no writes AND no setting changes; 2 = writes blocked but settings can change.
  -- Prefer 1 if your client doesn't need to override anything.
  readonly = 1 READONLY,

  -- Time and memory
  max_execution_time = 30 READONLY,                    -- 30 seconds wall-clock per query
  max_memory_usage = 5000000000 READONLY,              -- 5 GB per query
  max_memory_usage_for_user = 10000000000 READONLY,    -- 10 GB across this user's concurrent queries

  -- Data scanned (the main exfiltration / DoS lever)
  max_rows_to_read = 1000000000 READONLY,              -- 1 billion rows scanned per query
  max_bytes_to_read = 100000000000 READONLY,           -- 100 GB scanned per query
  read_overflow_mode = 'throw' READONLY,               -- error out (don't truncate) when scan caps hit

  -- Result size returned to the client. Tuned for LLM consumption: an LLM
  -- with a 1M-token context can comfortably absorb ~1 MB of NDJSON (~250k
  -- tokens) without saturating its working set. 'throw' (not 'break') gives
  -- the caller a clear error to retry with LIMIT or a narrower WHERE rather
  -- than silently-truncated rows that look complete. Note: 'break' only
  -- breaks at block boundaries (default max_block_size=65536), so for small
  -- caps it is essentially advisory — 'throw' is the only way to enforce a
  -- hard row count.
  max_result_rows = 1000 READONLY,                     -- 1k rows returned to the client
  max_result_bytes = 1048576 READONLY,                 -- 1 MB returned to the client (~250k tokens)
  result_overflow_mode = 'throw' READONLY,             -- hard error when result caps hit (not silent truncation)

  -- Concurrency and CPU per query
  max_threads = 8 READONLY,                            -- 8 threads per query
  max_concurrent_queries_for_user = 20 READONLY,       -- 20 concurrent queries from this user

  -- Bandwidth
  max_network_bandwidth = 50000000 READONLY,           -- 50 MB/s per query
  max_network_bandwidth_for_user = 100000000 READONLY, -- 100 MB/s across this user

  -- Query complexity (stops AST-bomb / pathological queries)
  max_ast_elements = 10000 READONLY,                   -- 10k AST nodes before parse
  max_expanded_ast_elements = 100000 READONLY,         -- 100k AST nodes after macro/view expansion
  max_query_size = 262144 READONLY,                    -- 256 KB query text

  -- Stop slow scans early
  timeout_before_checking_execution_speed = 10 READONLY, -- 10s grace before speed check kicks in
  min_execution_speed = 1000000 READONLY,              -- 1M rows/s minimum after the grace window

  -- Disable dangerous I/O explicitly (readonly=1 already blocks most)
  allow_ddl = 0 READONLY,                              -- no CREATE/ALTER/DROP
  allow_introspection_functions = 0 READONLY;          -- no addressToLine/demangle/etc.

-- Role: SELECT only on the four tenant-scoped read tables. We deliberately
-- avoid `app.*` so future internal tables (and app.tenant_retention_source,
-- which is cross-tenant and has no RLS) don't auto-expand the surface area.
-- Per-org users `sql_api_org_<id>` are granted this role at provision time.
CREATE ROLE IF NOT EXISTS sql_api_role SETTINGS PROFILE 'sql_api_profile';
GRANT SELECT ON app.traces        TO sql_api_role;
GRANT SELECT ON app.logs          TO sql_api_role;
GRANT SELECT ON app.metrics_gauge TO sql_api_role;
GRANT SELECT ON app.metrics_sum   TO sql_api_role;

-- Clean up accidental/manual system grants. SHOW TABLES handles schema
-- discovery without exposing storage counters from system.tables or the
-- shared quota counter from system.quota_usage.
REVOKE SELECT ON system.tables FROM sql_api_role;
REVOKE SELECT ON system.quota_usage FROM sql_api_role;

-- web_app_admin needs ADMIN OPTION on sql_api_role to grant it to the per-org
-- users it provisions. Granted here (not in 00-setup.sh) because the role
-- doesn't exist yet at that point in the boot order.
GRANT sql_api_role TO web_app_admin WITH ADMIN OPTION;

-- Quota: per-tenant limits. Keyed by client_key so each org gets its own
-- bucket via the X-ClickHouse-Quota header (querySqlApi in
-- packages/app/src/lib/clickhouse.ts sets it to the per-org username). The CH
-- client never propagates a header from user input, so the key is not
-- attacker-controlled. OR REPLACE so the keying change applies on fresh init
-- even when the quota name was already created by an earlier image.
CREATE QUOTA OR REPLACE sql_api_quota
  KEYED BY client_key
  FOR INTERVAL 1 minute MAX queries = 120, errors = 20,
  FOR INTERVAL 1 hour   MAX queries = 2400, read_rows = 20000000000, execution_time = 1200
  TO sql_api_role;

-- Default-deny row policies for sql_api_role. Per-org row policies attached
-- to each `sql_api_org_<id>` user OR-combine with these to expose exactly
-- one tenant's rows per query. Defense in depth: if provisioning ever skips
-- the per-org policy step, the user sees zero rows rather than all rows.
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_traces
  ON app.traces        FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_logs
  ON app.logs          FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_metrics_gauge
  ON app.metrics_gauge FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_metrics_sum
  ON app.metrics_sum   FOR SELECT USING 0 TO sql_api_role;
