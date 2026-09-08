# JSON Attribute Columns Design

> **Design for the JSON attribute columns on logs and traces.** Written on 2026-09-07 for the work folded into PR #426. Like `2026-09-03-clickhouse-direct-ingest.md`, this file stays out of the repo. The implementation tasks follow the design once the design is reviewed.

**Goal:** Attribute reads on logs and traces stop paying for the whole map. A filter on one key, the key list of the filter UI and the values of one key read one column each, with typed values, and the storage cost stays the same.

**Architecture:** The attribute columns of `app.logs` and `app.traces` change from `Map(LowCardinality(String), String)` to the `JSON` type, exactly as the upstream ClickHouse exporter does when its `json` option is on: the same column set, one `*Keys Array(LowCardinality(String))` column next to each attribute column with a `bloom_filter` index on it, and the exporter's JSON insert path, which writes each attribute with its own type. The landing tables `otel.otel_logs` and `otel.otel_traces` take the same columns, the views pass them through, and the app tables apply the tenant and retention strip as `SKIP` paths on the type. Sort keys, partition keys, TTL and codecs from PR #426 do not change. The local chDB store gets the same schema through our exporter fork, which already carries upstream's JSON mode. The metrics tables keep their maps.

**Tech Stack:** ClickHouse 26.5 and chDB 26.5, upstream `clickhouseexporter` v0.160.0 and our fork `collector/exporter/chdbexporter`, the shared attribute filter module in `packages/telemetry-explorer`, the run and workflow pages in `packages/app`, the skills in `crates/everr-core/assets/skills`.

**Spec:** This document is the spec. Evidence comes from the benchmarks of 2026-09-06 and 2026-09-07 recorded below and from the production key counts of 2026-09-07.

## Global Constraints

- Never mention Claude, Anthropic or AI assistance in commits, PR text or code comments.
- Docs and comments use ASD-STE100 Simplified Technical English. No em dashes or en dashes anywhere in docs.
- No docker test suites locally. Container checks run on throwaway containers from `clickhouse/Dockerfile`, never on the dev stack.
- Custom attributes stay under the `everr.` prefix. This design does not rename any attribute.

## Decisions taken

1. **Typed values.** The exporter's JSON mode marshals the attributes with their types. An integer attribute is a number in the document and a boolean is a boolean. Comparisons in generated SQL go through `toString()` so the explorer keeps string semantics.
2. **Folded into PR #426.** The cut-over of #426 rebuilds every `app.*` table empty with no backfill. The JSON schema is part of that rebuild, so production is rebuilt once.
3. **All attribute columns, cloud and local.** Logs: `ResourceAttributes`, `ScopeAttributes`, `LogAttributes`. Traces: `ResourceAttributes`, `SpanAttributes`, `Events.Attributes`, `Links.Attributes`. Upstream has no scope attributes on traces and neither do we. The local store follows so the explorer, the skills and users see one syntax.
4. **Exactly upstream's JSON schema.** Column types, the `*Keys` columns, their indexes and the insert templates come from upstream. Our sort keys, partitions, TTL, codecs and the tenant and retention stamping stay ours.
5. **Metrics stay Map.** The attribute map is the series key there, in `ORDER BY` through `cityHash64(Attributes)` and in every `GROUP BY`. A JSON value is not comparable and cannot serve either.

## Open decision: the dynamic path limit

Upstream declares the columns as plain `JSON`, so `max_dynamic_paths` is 1,024. Every distinct key up to that count gets a column of its own in each part, and the rest go to the shared store.

- With today's key space the limit is never reached. Production holds 136 distinct `LogAttributes` keys across all tenants and 129 `SpanAttributes` keys on the largest tenant, and one batch part carried at most 75 log keys. Every key gets a column, which is the fastest read.
- The limit is the guard against a tenant that sends thousands of distinct keys. In the benchmark, mixed-tenant parts at the default limit with 6,000 custom keys could not be merged inside 3.4 GiB: a merge of 12 parts opened too many streams and 2,441 merges failed in ten minutes. At `max_dynamic_paths = 64` the same table merged and read faster than the Map.
- The limit is part of the column type. Changing it later rewrites the column.

Decision of 2026-09-07: the attribute columns are declared `JSON(max_dynamic_paths = 256)`. It changes nothing for today's keys and caps the per-part cost for a wide key space. The decision stays open: the shadow table on production (see the gate) measures merge memory, merge duration and files per part on the real workload, and the value is confirmed or changed from that measurement before the cut-over. The limit is set in one place per table in `init/10` and in the chDB templates, so changing it is one edit and a rebuild of the throwaway containers.

## Why JSON: the measurements

Two tables of 4M log rows, 20 tenants, 20 semantic-convention keys on every row and 3 of 6,000 custom keys per row, `Map(LowCardinality(String), String)` against `JSON(max_dynamic_paths = 64)`, both `ORDER BY (tenant_id, ServiceName, Timestamp)`, one part per partition, ClickHouse 26.5 in a 3.44 GiB container, warm minimum of three runs.

One tenant, one day, about 200,000 rows in the window:

| Query | Map | JSON |
|---|---|---|
| filter on a semantic-convention key | 28 ms | 4 ms |
| filter on a custom key in the shared store | 32 ms | 4 ms |
| key exists, through the keys bloom index | 30 ms | 7 ms |
| group by `http.route` | 24 ms | 5 ms |
| average of a numeric value | 27 ms | 5 ms |
| status code compared as a number | 28 ms | 4 ms |
| fetch 100 rows with all attributes | 15 ms | 46 ms |

The Map reads and decodes all 23 pairs of every row to answer one key, 55 MiB of peak memory per query against 2 MiB. The JSON reads one path's column, or one of the 32 buckets of the shared store. The full-row fetch is the one loss: the JSON reassembles each document from its columns and buckets.

The attribute key list, the query behind the filter UI, `SELECT DISTINCT arrayJoin(...)` with a limit of 200:

| Window | Rows | Map, `mapKeys` | JSON, the `*Keys` column |
|---|---|---|---|
| one tenant, one day | 74k | 36 ms | 9 ms |
| one tenant, three days | 221k | 67 ms | 10 ms |
| twenty tenants, one day | 1.33M | 312 ms | 42 ms |

`distinctJSONPaths` and `JSONAllPaths` read the whole JSON column and are slower than the Map, 63 to 928 ms. The keys column is what makes the list fast, and it is upstream's column.

The values of one key, the query behind the value picker, `SELECT DISTINCT ... ORDER BY v LIMIT 100`, with and without the search box's substring filter:

| Window | Key | Map | JSON |
|---|---|---|---|
| one tenant, one day | `http.route`, on every row | 37 ms | 10 ms |
| one tenant, one day | a custom key in the shared store | 43 ms | 12 ms |
| one tenant, three days | `http.route` | 68 ms | 16 ms |
| one tenant, three days | custom key | 80 ms | 14 ms |
| twenty tenants, one day | `http.route` | 304 ms | 54 ms |
| twenty tenants, one day | custom key of one tenant | 41 ms | 10 ms |

The search variant costs the same as the plain one on both sides. Peak memory is 6 to 19 MiB for JSON against 45 to 177 MiB for the Map.

Storage: the attribute column is 152 MiB as JSON and 148 MiB as Map at 4M rows, plus 9 MiB for the keys column.

Merges: a JSON merge of six 55,000-row parts peaked at 543 MiB and of four 333,000-row parts at 425 MiB; a Map merge of eight 1.3M-row parts peaked at 160 MiB. Merges are the cost of JSON, and they are memory, not time.

## ClickHouse facts the design rests on, verified on 26.5

- `JSON(SKIP `a`, SKIP `b`)` drops the two paths at insert. A `CAST` from a plain `JSON` into that type drops them too, so a view can pass a landing column through and the app table's type does the strip.
- A String query parameter compares correctly against a typed value: `j.status = {v:String}` is true for the number 500. `toString(j.status) = {v:String}` is the same and is what the explorer emits, so the semantics are string equality by construction.
- `` j.`http.route` `` and `j.http.route` are the same path. A key with a backtick works when the backtick is escaped inside the identifier.
- The identifier form reads only the subcolumn: `` j.`http.route` `` shows `j.http.route Dynamic` at the read step. `getSubcolumn(j, {key:String})` reads the whole JSON column, with or without `optimize_functions_to_subcolumns`, so generated SQL must put the key into the identifier, never into a parameter.
- `has(colKeys, {key:String})` prunes with the bloom index the same as a literal, 1 of 12 granules for a rare key. `NOT has(...)` reads every granule, as today's `NOT mapContains(...)` does.
- A `GROUP BY` or `ORDER BY` on a raw path is refused, because the value is `Dynamic`. `GROUP BY toString(col.`k`)` works, and so does a typed subcolumn such as `.:String`.
- A typed path hint such as `JSON(status Int64)` rejects the whole insert when one value has another type. The design uses no hints.
- `toString()` of a missing path is `''` and its type is `String`, not `Nullable(String)`. So `= ''`, `!= ''` and `GROUP BY` on the `toString` form keep the Map's meaning, absence included. The raw path is `NULL` for a missing key.
- `toUInt32OrZero(col.`k`)` fails on an `Int64` value: the `OrZero` conversions take only strings. `toUInt32OrZero(toString(col.`k`))` gives the same result whatever the stored type and 0 when the key is missing.
- A numeric comparison on the raw path, `col.`k` >= 10`, fails with `NO_COMMON_TYPE` when the rows it runs over hold an `Int64` in one row and a `String` in another. Verified with two tenants in one merged part: the tenant storing numbers compares the raw path without error, because the tenant filter runs first; the tenant storing text fails, as a `String` column compared to a number always did; a tenant whose own rows mix the two types fails. A typed subcolumn such as `col.`k`.:Int64` is `NULL` for every row whose stored type is different, silently. Every generated read therefore goes through `toString()`.
- `toString(getSubcolumn(j, 'path'))` in `CREATE TABLE ... AS SELECT` over the `Null` landing table yields a plain `String` column, so `tenant_id` keeps its type and its place in the sort key.

## Schema

`clickhouse/init/10-create-mvs.sql`, for `app.logs`:

```sql
ResourceAttributes JSON(max_dynamic_paths = 256, SKIP `everr.retention.days`) CODEC(ZSTD(1)),
ResourceAttributesKeys Array(LowCardinality(String)) CODEC(ZSTD(1)),
ScopeAttributes JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
ScopeAttributesKeys Array(LowCardinality(String)) CODEC(ZSTD(1)),
LogAttributes JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
LogAttributesKeys Array(LowCardinality(String)) CODEC(ZSTD(1)),
INDEX idx_res_attr_keys ResourceAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
INDEX idx_scope_attr_keys ScopeAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
INDEX idx_log_attr_keys LogAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
```

`app.traces` takes `ResourceAttributes`, `SpanAttributes`, their keys columns and indexes, and `Events.Attributes JSON` and `Links.Attributes JSON` inside the two `Nested` columns, as upstream's `traces_json_table.sql`.

- The `mapValues` bloom indexes (`idx_*_attr_value`) go. A filter on one key reads that key's column and needs no value index.
- The `*Keys` columns are load-bearing for two reads: the exists filter, through the index, and the key list, which reads them instead of the attribute column.
- `ResourceAttributesKeys` still lists `everr.retention.days` because the exporter fills it before the strip. The views filter that name out with `arrayFilter`, so the keys column and the document agree. `everr.tenant.id` stays in the document and in the keys, as it does today.
- Sort keys, partition keys, TTL, codecs and `ttl_only_drop_parts` do not change. The comments next to the keys stay valid.
- `clickhouse/init/05-create-retention-functions.sql` gains two UDFs for the JSON tables: `everrRetentionDaysJson` reads `toUInt16OrZero(toString(getSubcolumn(resourceAttributes, 'everr.retention.days')))`, which accepts a string or a number, and `everrStripRetentionKeys` filters the name out of the keys array. `everrRetentionDays` and `everrStripRetention` stay for the metrics views. The strip of the document is the `SKIP` on the app table's type. The tenant stamp reads `toString(getSubcolumn(ResourceAttributes, 'everr.tenant.id'))`; a view uses `getSubcolumn` because the block is already in memory and the identifier form has nothing to save there.
- `clickhouse/init/04-create-error-fingerprint-function.sql` and the chDB copy: `errorFingerprint` reads three keys of the map inside its body. It becomes `errorFingerprint(serviceName, fingerprint, exceptionType, exceptionMessage)`, four text arguments, so a query passes `toString(LogAttributes.`...`)` for each and reads three subcolumns instead of the whole column.
- `clickhouse/init/12-create-alert-events.sql`: the view that projects alert events into `app.logs` writes `map(...)` literals as the attribute columns. They become `CAST(map(...), 'JSON(max_dynamic_paths = 256)')` plus a keys array per column listing the same keys.
- `JSON(SKIP ...)` and `JSON` are two types. The views select the landing column as it is and the insert into the app table converts it, the same conversion the `CAST` check above verified.
- The landing tables `otel.otel_logs` and `otel.otel_traces` (`init/03`) take upstream's JSON column set with no `SKIP`, so the views can still read the retention stamp. They stay `ENGINE = Null`.
- The metrics tables in `init/10` and the `otel.otel_metrics_*` landing tables do not change.

## Ingest

- Cloud: the exporter in `everr-deploy/infra-v2/config/otel-collector-config.yaml` gets `json: true` next to `create_schema: false`. The exporter runs `DESCRIBE TABLE` on the landing table at start, finds the `*Keys` columns and fills them. `DESCRIBE` works on a `Null` table.
- The exporter's JSON insert writes each attribute with its OTel type. Our stamps arrive as resource attributes and keep the type the collector gives them; the UDF accepts both.
- Local: `collector/internal/localgateway/config/config.go` generates the chDB exporter config and gets `"json": true`. The fork's `logs_json_table.sql` and `traces_json_table.sql` in `collector/exporter/chdbexporter/internal/sqltemplates` take our `(ServiceName, Timestamp)` keys and the `bloom_filter` indexes the Map templates have, the same way the Map templates were adapted, and `EVERR_CHANGES.md` records it. `localSchemaVersion` stays at 1: version 1 has not shipped.
- The local `traces_trace_id_ts` lookup table and the cloud one do not change.

## Query surfaces

**The shared attribute filter module** (`packages/telemetry-explorer/src/attribute-filter/sql`):

| Query | Today | After |
|---|---|---|
| key list, `keys.ts` | `DISTINCT arrayJoin(mapKeys(col))` | `DISTINCT arrayJoin(colKeys)` |
| values of a key, `values.ts` | `DISTINCT col[{key}]` with `mapContains(col, {key})` and `!= ''` | `` DISTINCT toString(col.`key`) `` with `has(colKeys, {key:String})` and `!= ''` |
| `in`, `not_in`, `where.ts` | `col[{key}] IN {vals:Array(String)}` | `` toString(col.`key`) IN {vals:Array(String)} `` |
| `exists`, `missing` | `mapContains(col, {key})` | `has(colKeys, {key:String})` |

- The key goes into the SQL text as a quoted identifier. One helper, `jsonPath(column, key)`, renders `` column.`key` `` and escapes backticks and backslashes in the key. It is the only place that builds a path, and it is unit tested with dots, backticks, quotes and spaces in the key.
- `columnFor(source)` keeps returning the attribute column; a second helper derives the keys column name from it.
- The two helpers in `packages/telemetry-explorer/src/sql/resource-attributes.ts` render the identifier form and `has(ResourceAttributesKeys, ...)`.
- A `GROUP BY` or `ORDER BY` on an attribute uses the `toString` form.
- The whole-column reads that feed the UI (`logs/sql/detail.ts`, the error occurrences, the span rows) get a nested object back and flatten it on the client with dots, so `LogDetail`, `ErrorOccurrence` and `Span` keep their `Record<string, string>` attributes.
- `errors/sql/fingerprint.ts` calls the four-argument `errorFingerprint` with the three `toString` reads.

**The app** (`packages/app/src/data`): nine source files with Map syntax, the largest `repo-detail/server.ts` (37 sites), `runs/server.ts` (26), `workflows/server.ts` (17), `resource-usage.ts` (16), `run-query-helpers.ts` (12). Each `Attributes['k']` becomes `toString(X.`k`)` through the same helper; each `mapContains` becomes `has(XKeys, ...)`; each `toUInt32OrZero(X['k'])` becomes `toUInt32OrZero(toString(X.`k`))`, because the conversion refuses a `Dynamic` argument. The built-in dashboard capabilities file and the tests follow. The metrics sites in `resource-usage.ts` stay.

**The built-in dashboard catalog and the repo's own resources**: six catalog files under `packages/app/src/data/dashboards/built-in/catalog` (`http-endpoints`, `rpc-services`, `server-functions`, `serverless-functions`, `product-analytics`, `web-vitals`) query `traces` and `logs` with about 300 `X['k']` reads, every one in a value position. The `everr/` directory holds the org's own alert, dashboard and runbook queries with `SpanAttributes['k']` on `traces`. Both get the mechanical `toString(X.`k`)` rewrite; the ten catalog files on `metrics_*` and the `ResourceAttributes` reads on `metrics_gauge` in `everr/` stay. The user applies `everr/` after the cut-over.

**Skills and docs**: the ten skill files with Map syntax, led by `everr-use-telemetry/SKILL.md`, teach the `toString` form, `has(...Keys, ...)` and `toFloat64OrZero(toString(...))` for numbers. `packages/docs` gets a translation table on a reference page next to `reference/retention.mdx`: the shapes above, presence, `GROUP BY`, numeric comparison and the two traps (raw comparison across mixed types, typed subcolumns that read `NULL`).

**Users**: the `/sql` API and as-code dashboards and alert rules get a breaking syntax change. `Attributes['k']` on a JSON column is an error, not a wrong result. The release note for the cut-over carries the translation table.

## Gate before the cut-over

A shadow table on the production service for 24 hours, fed by a second view off today's `otel.otel_logs` (a MergeTree until the cut-over), casting the Map to JSON. It costs no collector change and reads the real batch shape and key mix.

The shadow table is the `app.logs` DDL of this design with `TTL toDate(Timestamp) + INTERVAL 2 DAY`. Its view selects every column of `otel.otel_logs` as the stamping view does, with the three attribute maps cast to `JSON` and the three keys arrays taken from `mapKeys()`. The values are strings in the shadow, because the Map holds strings; the merge cost and the file count do not depend on the value types.

Read after a day, then drop both:

- `system.part_log`: `peak_memory_usage` and `duration_ms` of every `MergeParts` event on the shadow table, next to `app.logs` for the same day.
- `system.parts` and the part directories: files per part, wide parts against compact.
- Keeper request metrics during merges, from the Cloud console.
- The explorer's key list, values and filter queries against both tables, from `system.query_log`.

The exact statements are written during implementation from the final DDL. The user runs them; nothing in this design applies SQL to production on its own.

## Rollout

Part of the #426 cut-over, `clickhouse/migrations/2026-09-03-direct-ingest.sh`, which drops and recreates every landing table, view and `app.*` table from `init/03`, `init/04`, `init/05`, `init/10` and `init/12`. Its guard reads the Map form on purpose: it runs against the old tables before anything is dropped.

1. Deploy the app and the collector as #426 already requires.
2. Run the cut-over. From this moment the landing tables are JSON, and a Map exporter's inserts fail.
3. Deploy the collector with `json: true`. The exporter's sending queue retries what fell in between; the window is the time between the two steps.
4. `everr-deploy`: the `json: true` line, next to the Terraform change #426 already lists.
5. `everr apply ./everr` for the org's own alert, dashboard and runbook queries, which the branch rewrites to the JSON form.

A JSON exporter against Map landing tables fails the same way, so the two steps cannot be swapped.

From step 1 until step 2 ends, the app's reads fail: its queries use the JSON form (`toString(X.`k`)`, `has(XKeys, ...)`, the four-argument `errorFingerprint`) against the Map columns. That covers the runs list and detail, workflows, repo detail, cost analysis, the home CI panel, the explorers and the built-in dashboards. The three steps run back to back in one window; the window is not closed, because closing it needs an app that emits both syntaxes.

Found on the dev stack after the volume reset on 2026-09-07: the trace id lookup view read `app.traces`, ClickHouse checks the inserting user against every view in the chain, and the collector user holds grants on `otel.*` only, so every trace insert failed after `app.traces_mv` had written its rows and the exporter retried the batch, which duplicated spans. Fixed on `ttl-improvements` (5ea35d231): the lookup view reads the landing table and stamps `tenant_id` and `retention_days` itself, like every other view. This branch carries the JSON form of the same view in its schema commit.

The local store bumps `localSchemaVersion` to 2. A store built at version 1 holds Map `logs` and `traces` tables under the same names, and `CREATE TABLE IF NOT EXISTS` would keep them; the rebuild replaces them at the cost of one 7-day cache.

## Verification

- Unit: `jsonPath` escaping; the four builder outputs of the filter module; the app query builders (`runs.test.ts` and siblings) assert the identifier form, `has(...)` and `toString(...)`; `clickhouse.test.ts` keeps its policy statement counts.
- Container, throwaway, from `clickhouse/Dockerfile`: fresh init creates the JSON tables and nine views; an insert with the two stamps lands with `tenant_id` and `retention_days` set and both paths absent from the stored document and the keys array; a document with a number and a string on the same path in two rows stores both; the cut-over against `main`'s schema ends with JSON columns on every attribute; the row policies and the `/sql` grants hold.
- The chDB round trip with `json: true`: an OTLP log with an integer attribute stores `Int64` (`dynamicType`), reads back as its digits through `toString`, and `has(LogAttributesKeys, ...)` finds it.
- The built-in dashboards and the `everr/` resources: after the rewrite no `X['k']` read is left on a `traces` or `logs` query, the manifest still loads every catalog file, and the HTTP endpoints dashboard renders on the dev stack.
- The benchmark script of 2026-09-07 rerun on the final DDL, both limits if the open decision goes to a guard, so the numbers in this document match what ships.
- `go test` and `golangci-lint` on the chDB exporter and the receiver, `vitest` and `tsc` on the app, the explorer and the desktop app.

## Risks

- **Merge memory and file count on Cloud.** The gate measures both on the real workload before the cut-over. The path limit is the lever if it is needed.
- **User queries break.** Documented and taught; the error is loud, not silent.
- **Typed values change semantics where the app compares a number to a string.** Attributes the receiver writes with `PutInt`, such as `everr.github.workflow_job_step.number`, become numbers. Every read goes through `toString()`, numbers through `toUInt32OrZero(toString(...))`, so a comparison is string equality as with the Map; the round-trip test reads one integer attribute back that way. A raw comparison on a mixed-type path fails loudly, and the docs say so.
- **The keys column and the document can disagree** if a view filters one and not the other. The container test asserts both after the strip.
