# everr cloud query design

## Goal

Add `everr cloud query` as an advanced, read-only investigation command for agents and developers debugging CI issues. The command should behave like `everr local query`, but run against cloud ClickHouse through the authenticated CLI API.

This is for questions that are too custom for `everr ci status`, `everr ci show`, `everr ci logs`, or `everr ci grep`.

## Non-goals

- Do not add write support.
- Do not add user-configurable query limit flags in the first version.
- Do not return a metadata envelope on stdout.
- Do not rewrite user SQL or inject manual `tenant_id` filters.
- Do not generate database migrations.

## User interface

Command:

```sh
everr cloud query "<SQL>"
```

Options should match `everr local query`:

```sh
everr cloud query "<SQL>" --format json
everr cloud query "<SQL>" --format ndjson
everr cloud query "<SQL>" --format table
```

Default output should also match `everr local query`:

- table format when stdout is a terminal
- NDJSON when stdout is piped

The output should be rows only. For `json`, print a pretty JSON array. For `ndjson`, print one JSON object per line. For `table`, use the existing simple table renderer.

## Architecture

Use a thin pass-through endpoint:

1. The CLI accepts a SQL string and optional `--format`.
2. The Rust API client sends `POST /api/cli/sql` with the raw SQL body.
3. The server route reads the SQL body from the request.
4. The route uses the existing `/api/cli` auth and active organization context.
5. The route executes the query through ClickHouse with tenant context and fixed limits.
6. The route returns `JSONEachRow` response content.
7. The CLI parses the returned rows and renders them with the same code path as `everr local query`.

## ClickHouse execution settings

The web app ClickHouse user already enforces read-only access. The route should still apply per-query limits so an agent cannot accidentally run an expensive query while debugging.

Initial settings:

- `SQL_everr_tenant_id`: current active organization id
- `max_result_rows`: `500`
- `max_result_bytes`: `5_000_000`
- `max_rows_to_read`: `50_000`
- `max_memory_usage`: `200_000_000`

Do not add `tenant_id = toUInt64(getSetting('SQL_everr_tenant_id'))` or any other manual tenant predicate. Everr already uses row-level policy for tenant isolation.

Do not use `PREWHERE`; ClickHouse can choose that optimization automatically.

## API behavior

Route: `POST /api/cli/sql`

Request:

- `Content-Type: text/plain`
- body is the SQL query

Validation:

- Empty or whitespace-only SQL returns `400` with `{ "error": "SQL query is required." }`.
- Other SQL validation is delegated to ClickHouse and the read-only ClickHouse user.

Response:

- Success returns newline-delimited JSON rows, matching `JSONEachRow`.
- ClickHouse errors return a non-2xx response with `{ "error": "<message>" }`.
- Auth/session errors follow the existing CLI API behavior.

## CLI behavior

The command should use the existing session flow:

- Require an active cloud session.
- Refresh session when possible using the existing auth helper.
- Send the bearer token through the existing `ApiClient`.
- Surface expired sessions using the existing "run `everr cloud login`" message.

Errors should be simple and readable:

- invalid SQL
- ClickHouse read-only rejection
- result/read/memory limit exceeded
- network/API failure
- expired session

## Skill guidance

Update the bundled CI debugging skill because `everr cloud query` is agent-useful.

Add a short "Cloud SQL" section:

```md
Use `everr cloud query "<SQL>"` for advanced read-only CI investigation when the focused CI commands do not answer the question.
```

Recommended starting tables:

- `traces`: workflow runs, jobs, steps, and test spans
- `logs`: step logs
- `metrics_gauge` and `metrics_sum`: resource metrics when needed

Explain that CI data mostly follows OpenTelemetry conventions:

- CI/CD semantic conventions: https://opentelemetry.io/docs/specs/semconv/cicd/
- CI/CD span conventions: https://opentelemetry.io/docs/specs/semconv/cicd/cicd-spans/
- CI/CD and VCS resource attributes: https://opentelemetry.io/docs/specs/semconv/resource/cicd/
- Test attributes: https://opentelemetry.io/docs/specs/semconv/registry/attributes/test/

Mention common Everr-specific fields:

- `SpanAttributes['everr.github.workflow_job_step.number']`
- `ResourceAttributes['everr.github.workflow_job.run_attempt']`
- `SpanAttributes['everr.test.name']`
- `SpanAttributes['everr.test.result']`
- `SpanAttributes['everr.test.duration_seconds']`
- `SpanAttributes['everr.test.package']`
- `SpanAttributes['everr.test.parent_test']`

Mention common storage patterns:

- Workflow run and job context is usually in `ResourceAttributes[...]`.
- Step context is usually in `SpanAttributes[...]` on `traces`.
- Step logs are in `logs.Body`.
- Log rows connect to jobs with `ScopeAttributes['cicd.pipeline.task.name']`.
- Log rows connect to steps with `LogAttributes['everr.github.workflow_job_step.number']`.
- Use `Timestamp` on `traces` and `TimestampTime` on `logs` for time filters.

Give simple filtering guidance for tests:

```sql
SELECT
  Timestamp,
  ResourceAttributes['vcs.repository.name'] AS repo,
  ResourceAttributes['vcs.ref.head.name'] AS branch,
  ResourceAttributes['cicd.pipeline.run.id'] AS run_id,
  SpanAttributes['everr.test.name'] AS test_name,
  SpanAttributes['everr.test.result'] AS result
FROM traces
WHERE Timestamp > now() - INTERVAL 7 DAY
  AND SpanAttributes['everr.test.name'] != ''
  AND SpanAttributes['everr.test.result'] IN ('pass', 'fail')
ORDER BY Timestamp DESC
LIMIT 50
```

Guidance for agents:

- Start with focused commands like `everr ci status`, `everr ci show`, and `everr ci logs`.
- Use `everr cloud query` only when a custom read is useful.
- Always include a time filter.
- Add repo, branch, run id, job, or test filters when known.
- Tenant filtering is automatic; do not filter on `tenant_id`.
- Avoid broad joins. Filter tables before joining.
- Prefer `ANY JOIN` when only one matching row is needed.

## Tests

Rust CLI parser and help tests:

- `everr cloud --help` lists `query`.
- `everr cloud query --help` shows the SQL argument and `--format`.
- `cloud query` accepts the same `TelemetryFormat` values as `local query`.
- Empty missing SQL is rejected by clap.

Rust command/API tests:

- `everr cloud query "SELECT 1" --format ndjson` sends `POST /api/cli/sql`.
- The request includes the bearer auth header.
- The request body is exactly the SQL text.
- A `JSONEachRow` response renders through the shared query renderer.
- Server error envelopes are shown as readable CLI errors.

Server route tests:

- Valid SQL calls ClickHouse with the SQL text.
- Valid SQL applies `SQL_everr_tenant_id` and fixed query limits.
- Empty SQL returns `400`.
- ClickHouse errors return a non-2xx JSON error envelope.

Skill/docs tests:

- If there is an existing bundled skill snapshot/sync test, update it so the new CI debugging guidance stays in sync.

## Notes from ClickHouse rules

Per `schema-pk-filter-on-orderby`, examples and skill guidance should encourage time and other selective filters so queries avoid broad scans.

Per `query-join-filter-before`, skill guidance should tell agents to filter before joining.

Per `query-join-use-any`, skill guidance should recommend `ANY JOIN` when only one match is needed.

Per repo instructions, do not add manual tenant filters and do not use `PREWHERE`.
