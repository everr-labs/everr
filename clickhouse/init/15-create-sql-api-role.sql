-- Settings profile: hard caps for the /sql API. All READONLY so per-query
-- SETTINGS ... clauses cannot loosen them.
--
-- init/ runs only on a fresh server, and IF NOT EXISTS skips an existing
-- profile, so editing a value here does NOT reach a running cluster. Apply a
-- change there with ALTER, and pass EVERY setting: ALTER ... SETTINGS
-- replaces the profile's element list wholesale rather than merging, so a
-- partial statement silently drops readonly = 1 and every cap with it.
--   clickhouse-client --user default --password '<ADMIN_PASSWORD>' --query \
--     "ALTER SETTINGS PROFILE sql_api_profile SETTINGS <all of the below>"
-- Then confirm nothing was lost:
--   SELECT setting_name, value, writability
--   FROM system.settings_profile_elements WHERE profile_name = 'sql_api_profile';
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

  -- Result size returned to the client. Rows are sized for time-series
  -- panels (~500 points/series x ~50 series, ~40-80B each). Bytes stay tight
  -- on purpose: they are the cap that binds for wide rows (traces, profiles),
  -- and 4 MB clears 25k series rows either way. An LLM reading the same API
  -- is bounded by the byte cap, not the row cap (~1M tokens of NDJSON).
  -- 'throw' (not 'break') gives the caller a clear error to retry with LIMIT
  -- or a narrower WHERE rather than silently-truncated rows that look
  -- complete. Note: 'break' only breaks at block boundaries (default
  -- max_block_size=65536), so for small caps it is essentially advisory —
  -- 'throw' is the only way to enforce a hard row count.
  max_result_rows = 25000 READONLY,                    -- 25k rows returned to the client
  max_result_bytes = 4194304 READONLY,                 -- 4 MB returned to the client
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

-- Role: SELECT only on the readable product tables. We deliberately
-- avoid `app.*` so a future internal table with no row policy does not
-- auto-expand the surface area.
CREATE ROLE IF NOT EXISTS sql_api_role SETTINGS PROFILE 'sql_api_profile';
