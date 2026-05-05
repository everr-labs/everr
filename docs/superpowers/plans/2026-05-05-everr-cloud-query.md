# everr cloud query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `everr cloud query` as a read-only cloud ClickHouse query command with the same output behavior as `everr local query`.

**Architecture:** Add a thin `POST /api/cli/sql` server route that runs raw SQL through the existing authenticated ClickHouse context with fixed query limits. Add a Rust CLI subcommand that posts SQL to that route and renders the returned `JSONEachRow` rows with the same renderer used by local telemetry queries.

**Tech Stack:** Rust CLI (`clap`, `reqwest`, `serde_json`, `mockito`), TanStack Start file routes, ClickHouse JS client wrapper, Vitest, bundled Everr skills.

---

## File Structure

- Create `packages/app/src/routes/api/cli/sql.ts`: CLI SQL route.
- Create `packages/app/src/routes/api/cli/sql.test.ts`: route tests for validation, ClickHouse settings, and error envelopes.
- Modify `packages/app/src/lib/clickhouse.ts`: add a settings-aware query helper for this route.
- Modify `crates/everr-core/src/api.rs`: add `post_sql` API method that posts text SQL and returns text rows.
- Modify `packages/desktop-app/src-cli/src/cli.rs`: add `CloudSubcommand::Query(TelemetryQueryArgs)`.
- Modify `packages/desktop-app/src-cli/src/main.rs`: route cloud query to CLI implementation.
- Modify `packages/desktop-app/src-cli/src/core.rs`: add `cloud_query`.
- Modify `packages/desktop-app/src-cli/src/telemetry/client.rs`: expose reusable `Rows` parsing from NDJSON.
- Modify `packages/desktop-app/src-cli/src/telemetry/commands.rs`: expose reusable query rendering.
- Modify `packages/desktop-app/src-cli/tests/api_commands.rs`: add cloud query API tests.
- Modify `packages/desktop-app/src-cli/tests/help_output.rs`: add cloud query help tests.
- Modify `crates/everr-core/assets/skills/ci-debugging/SKILL.md`: add concise cloud SQL guidance and storage hints.

## Task 1: Server Route

**Files:**
- Create: `packages/app/src/routes/api/cli/sql.ts`
- Create: `packages/app/src/routes/api/cli/sql.test.ts`
- Modify: `packages/app/src/lib/clickhouse.ts`

- [ ] **Step 1: Write failing route tests**

Create `packages/app/src/routes/api/cli/sql.test.ts` with tests that mock `queryWithClickHouseSettings` from `@/lib/clickhouse`, call the route handler directly, and expect:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  queryWithClickHouseSettings: vi.fn(),
}));

import { queryWithClickHouseSettings } from "@/lib/clickhouse";
import { Route } from "./sql";

const mockedQueryWithClickHouseSettings = vi.mocked(
  queryWithClickHouseSettings,
);

type PostHandler = (args: {
  request: Request;
  context: {
    session: { session: { activeOrganizationId: string } };
  };
}) => Promise<Response>;

function getHandler(): PostHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { POST?: PostHandler } };
  };
  const handler = routeOptions.server?.handlers?.POST;
  if (!handler) {
    throw new Error("Missing POST handler for /api/cli/sql.");
  }
  return handler;
}

const context = {
  session: { session: { activeOrganizationId: "org-42" } },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/sql", () => {
  it("runs SQL with tenant context and fixed limits", async () => {
    mockedQueryWithClickHouseSettings.mockResolvedValue([{ ok: 1 }]);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/sql", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "SELECT 1 AS ok",
      }),
      context,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/x-ndjson",
    );
    expect(mockedQueryWithClickHouseSettings).toHaveBeenCalledWith(
      "SELECT 1 AS ok",
      "org-42",
      {
        max_memory_usage: 200_000_000,
        max_result_bytes: 5_000_000,
        max_result_rows: 500,
        max_rows_to_read: 50_000,
      },
    );
    expect(await response.text()).toBe('{"ok":1}\n');
  });

  it("returns 400 for empty SQL", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/sql", {
        method: "POST",
        body: "   ",
      }),
      context,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "SQL query is required." });
    expect(mockedQueryWithClickHouseSettings).not.toHaveBeenCalled();
  });

  it("returns a JSON error envelope when ClickHouse rejects the query", async () => {
    mockedQueryWithClickHouseSettings.mockRejectedValue(
      new Error("Syntax error near nope"),
    );

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/sql", {
        method: "POST",
        body: "SELECT nope",
      }),
      context,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Syntax error near nope" });
  });
});
```

- [ ] **Step 2: Run route tests and verify RED**

Run:

```sh
pnpm --filter @everr/app test:ci -- src/routes/api/cli/sql.test.ts
```

Expected: failure because `./sql` does not exist.

- [ ] **Step 3: Add a settings-aware ClickHouse helper**

In `packages/app/src/lib/clickhouse.ts`, add:

```ts
export async function queryWithClickHouseSettings<T>(
  query: string,
  organizationId: string,
  clickhouseSettings: Record<string, unknown>,
  query_params?: Record<string, unknown>,
): Promise<T[]> {
  if (typeof organizationId !== "string" || !organizationId) {
    throw new Error("Missing ClickHouse tenant context");
  }

  const result = await clickhouse.query({
    query,
    query_params,
    format: "JSONEachRow",
    clickhouse_settings: {
      SQL_everr_tenant_id: organizationId,
      ...clickhouseSettings,
    },
  });

  return result.json<T>();
}
```

- [ ] **Step 4: Implement the route**

Create `packages/app/src/routes/api/cli/sql.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { queryWithClickHouseSettings } from "@/lib/clickhouse";

const CLOUD_SQL_LIMITS = {
  max_memory_usage: 200_000_000,
  max_result_bytes: 5_000_000,
  max_result_rows: 500,
  max_rows_to_read: 50_000,
} as const;

export const Route = createFileRoute("/api/cli/sql")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const sql = await request.text();
        if (!sql.trim()) {
          return Response.json(
            { error: "SQL query is required." },
            { status: 400 },
          );
        }

        try {
          const rows = await queryWithClickHouseSettings<
            Record<string, unknown>
          >(
            sql,
            context.session.session.activeOrganizationId,
            CLOUD_SQL_LIMITS,
          );
          const body = rows.map((row) => JSON.stringify(row)).join("\n");
          return new Response(body ? `${body}\n` : "", {
            headers: {
              "content-type": "application/x-ndjson; charset=utf-8",
            },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "ClickHouse query failed.";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});
```

- [ ] **Step 5: Run route tests and verify GREEN**

Run:

```sh
pnpm --filter @everr/app test:ci -- src/routes/api/cli/sql.test.ts
```

Expected: all tests in `sql.test.ts` pass.

## Task 2: Rust CLI and Shared Rendering

**Files:**
- Modify: `crates/everr-core/src/api.rs`
- Modify: `packages/desktop-app/src-cli/src/cli.rs`
- Modify: `packages/desktop-app/src-cli/src/main.rs`
- Modify: `packages/desktop-app/src-cli/src/core.rs`
- Modify: `packages/desktop-app/src-cli/src/telemetry/client.rs`
- Modify: `packages/desktop-app/src-cli/src/telemetry/commands.rs`
- Modify: `packages/desktop-app/src-cli/tests/api_commands.rs`
- Modify: `packages/desktop-app/src-cli/tests/help_output.rs`

- [ ] **Step 1: Write failing CLI tests**

Add to `packages/desktop-app/src-cli/tests/help_output.rs`:

```rust
#[test]
fn cloud_help_lists_query_subcommand() {
    let env = CliTestEnv::new();

    env.command()
        .args(["cloud", "--help"])
        .assert()
        .success()
        .stdout(contains("query"));
}

#[test]
fn cloud_query_help_lists_format_option() {
    let env = CliTestEnv::new();

    env.command()
        .args(["cloud", "query", "--help"])
        .assert()
        .success()
        .stdout(contains("<SQL>"))
        .stdout(contains("--format <FORMAT>"));
}
```

Add to `packages/desktop-app/src-cli/tests/api_commands.rs`:

```rust
#[test]
fn cloud_query_posts_sql_and_renders_ndjson_rows() {
    let env = CliTestEnv::new();
    let mut server = mock_api_server();
    env.write_session(&server.url(), "token-sql");

    let mock = server
        .mock("POST", "/api/cli/sql")
        .match_header("authorization", "Bearer token-sql")
        .match_header("content-type", "text/plain")
        .match_body("SELECT 1 AS ok")
        .with_status(200)
        .with_header("content-type", "application/x-ndjson")
        .with_body("{\"ok\":1}\n")
        .create();

    env.command_with_api_base_url(&server.url())
        .args(["cloud", "query", "SELECT 1 AS ok", "--format", "ndjson"])
        .assert()
        .success()
        .stdout(diff("{\"ok\":1}\n"));

    mock.assert();
}

#[test]
fn cloud_query_surfaces_error_envelope() {
    let env = CliTestEnv::new();
    let mut server = mock_api_server();
    env.write_session(&server.url(), "token-sql");

    server
        .mock("POST", "/api/cli/sql")
        .with_status(400)
        .with_body(r#"{"error":"Syntax error near nope"}"#)
        .create();

    env.command_with_api_base_url(&server.url())
        .args(["cloud", "query", "SELECT nope"])
        .assert()
        .failure()
        .stderr(contains("Syntax error near nope"));
}
```

- [ ] **Step 2: Run CLI tests and verify RED**

Run:

```sh
cargo test -p everr-cli --test help_output cloud_query_help_lists_format_option
cargo test -p everr-cli --test api_commands cloud_query_posts_sql_and_renders_ndjson_rows
```

Expected: failures because `cloud query` does not exist.

- [ ] **Step 3: Expose NDJSON parsing and row rendering**

In `packages/desktop-app/src-cli/src/telemetry/client.rs`, change `parse_ndjson` to:

```rust
pub fn parse_ndjson(body: &str) -> Result<Rows> {
```

In `packages/desktop-app/src-cli/src/telemetry/commands.rs`, change `render` to:

```rust
pub(crate) fn render(rows: &Rows, format: TelemetryFormat) {
```

- [ ] **Step 4: Add API client method**

In `crates/everr-core/src/api.rs`, add this method inside `impl ApiClient`:

```rust
pub async fn post_sql(&self, sql: &str) -> Result<String> {
    let response = self
        .http
        .post(format!("{}/sql", self.base_endpoint))
        .header(CONTENT_TYPE, HeaderValue::from_static("text/plain"))
        .body(sql.to_string())
        .send()
        .await
        .context("CLI SQL request failed")?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "<failed to read body>".to_string());
        return Err(http_status_error(status, text, "CLI SQL request"));
    }

    response
        .text()
        .await
        .context("failed to read CLI SQL response body")
}
```

- [ ] **Step 5: Add CLI subcommand and handler**

In `packages/desktop-app/src-cli/src/cli.rs`, add to `CloudSubcommand`:

```rust
/// Run a read-only SQL query against cloud CI data
Query(TelemetryQueryArgs),
```

In `packages/desktop-app/src-cli/src/main.rs`, add to the cloud match:

```rust
CloudSubcommand::Query(args) => core::cloud_query(args).await?,
```

In `packages/desktop-app/src-cli/src/core.rs`, add imports:

```rust
use std::io::{self, IsTerminal, Write};

use crate::cli::{
    GetLogsArgs, GrepArgs, ListRunsArgs, LogPagingArgs, ShowRunArgs, StatusArgs, TelemetryFormat,
    TelemetryQueryArgs, WatchArgs,
};
use crate::telemetry;
```

Then add:

```rust
pub async fn cloud_query(args: TelemetryQueryArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let body = client.post_sql(&args.sql).await?;
    let rows = telemetry::client::parse_ndjson(&body)?;
    let format = args.format.unwrap_or_else(|| {
        if io::stdout().is_terminal() {
            TelemetryFormat::Table
        } else {
            TelemetryFormat::Ndjson
        }
    });
    telemetry::commands::render(&rows, format);
    Ok(())
}
```

Import `std::io::IsTerminal` in `core.rs`.

- [ ] **Step 6: Run CLI tests and verify GREEN**

Run:

```sh
cargo test -p everr-cli --test help_output cloud
cargo test -p everr-cli --test api_commands cloud_query
```

Expected: all matching tests pass.

## Task 3: Skill Guidance

**Files:**
- Modify: `crates/everr-core/assets/skills/ci-debugging/SKILL.md`

- [ ] **Step 1: Update the bundled skill**

Add `everr cloud query "<SQL>"` to the command table and add a short "Cloud SQL" section with:

````md
## Cloud SQL

Use `everr cloud query "<SQL>"` for advanced read-only CI investigation when the focused commands above do not answer the question.

Start with:
- `traces` for workflow runs, jobs, steps, and test spans
- `logs` for step logs
- `metrics_gauge` and `metrics_sum` for resource metrics

CI data mostly follows OpenTelemetry conventions:
- CI/CD semantic conventions: https://opentelemetry.io/docs/specs/semconv/cicd/
- CI/CD spans: https://opentelemetry.io/docs/specs/semconv/cicd/cicd-spans/
- CI/CD and VCS resource attributes: https://opentelemetry.io/docs/specs/semconv/resource/cicd/
- Test attributes: https://opentelemetry.io/docs/specs/semconv/registry/attributes/test/

Common Everr-specific fields:
- `SpanAttributes['everr.github.workflow_job_step.number']`
- `ResourceAttributes['everr.github.workflow_job.run_attempt']`
- `SpanAttributes['everr.test.name']`
- `SpanAttributes['everr.test.result']`
- `SpanAttributes['everr.test.duration_seconds']`
- `SpanAttributes['everr.test.package']`
- `SpanAttributes['everr.test.parent_test']`

Test filtering example:

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

Always include a time filter. Add repo, branch, run id, job, or test filters when known. Tenant filtering is automatic; do not filter on `tenant_id`.
````

- [ ] **Step 2: Verify formatting**

Run:

```sh
sed -n '1,180p' crates/everr-core/assets/skills/ci-debugging/SKILL.md
```

Expected: Markdown renders as nested code fences correctly and the command table stays concise.

## Task 4: Final Verification

**Files:**
- All changed files.

- [ ] **Step 1: Run focused app route tests**

```sh
pnpm --filter @everr/app test:ci -- src/routes/api/cli/sql.test.ts
```

Expected: pass.

- [ ] **Step 2: Run focused CLI tests**

```sh
cargo test -p everr-cli --test help_output cloud
cargo test -p everr-cli --test api_commands cloud_query
```

Expected: pass.

- [ ] **Step 3: Run format/check commands for touched areas**

```sh
cargo fmt --all --check
pnpm --filter @everr/app typecheck
```

Expected: pass or record exact existing failures if unrelated.

- [ ] **Step 4: Review diff for scope**

```sh
git diff --stat
git diff --check
```

Expected: only planned files changed, no whitespace errors.
