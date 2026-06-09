# Alerting Apply Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first alerting-as-code slice: validate alert YAML resources, run `alerts test` against cloud SQL, and expose the command through the Rust CLI.

**Architecture:** This branch does not implement alert persistence, Graphile scheduling, notifications, or destructive apply reconciliation because the shared `everr apply <dir>` framework from the dashboard direction is not present in this checkout. It creates a standalone alert resource parser under `packages/app/src/data/alerts`, a CLI API route under `packages/app/src/routes/api/cli/alerts/test.ts`, and a Rust `everr alerts test <dir>` command that discovers YAML files and posts them to the route.

**Tech Stack:** TanStack Start API routes, Zod, `js-yaml`, ClickHouse SQL API helper, Rust Clap CLI, `reqwest`, Vitest, Cargo integration tests.

---

## File Structure

- Create `packages/app/src/data/alerts/schema.ts` for YAML parsing, Zod validation, defaults, duplicate detection, and typed parsed resources.
- Create `packages/app/src/data/alerts/schema.test.ts` for resource parser unit tests.
- Create `packages/app/src/routes/api/cli/alerts/test.ts` for the cloud-backed alert test API route.
- Create `packages/app/src/routes/api/cli/alerts/test.test.ts` for route tests with mocked ClickHouse calls.
- Modify `packages/app/package.json` and `pnpm-lock.yaml` to make `js-yaml` and its types direct dependencies for `@everr/app`.
- Modify `crates/everr-core/src/api.rs` to add typed alert test request/response structs and `ApiClient::post_alerts_test`.
- Modify `packages/desktop-app/src-cli/src/cli.rs` to add `alerts test <dir>`.
- Modify `packages/desktop-app/src-cli/src/main.rs` to dispatch the command.
- Modify `packages/desktop-app/src-cli/src/core.rs` to discover `.yaml`/`.yml` files recursively, post them to the API, and print JSON.
- Modify `packages/desktop-app/src-cli/tests/api_commands.rs` and `packages/desktop-app/src-cli/tests/help_output.rs` for CLI behavior.

## Task 1: Alert Resource Parser

**Files:**
- Create: `packages/app/src/data/alerts/schema.ts`
- Create: `packages/app/src/data/alerts/schema.test.ts`
- Modify: `packages/app/package.json`
- Modify: `pnpm-lock.yaml`

- [x] **Step 1: Add failing parser tests**

Create `packages/app/src/data/alerts/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  parseAlertResourceFile,
  parseAlertResourceFiles,
} from "./schema";

const validRule = `
kind: AlertRule
metadata:
  name: high-5xx-routes
  project: platform
  labels:
    team: platform
spec:
  severity: critical
  evaluationInterval: 1m
  window: 5m
  summary: "\${row_count} routes have elevated 5xxs"
  description: "Top route: \${top_route}"
  query: |
    SELECT 1 AS ok
`;

describe("alert resource schema", () => {
  it("parses an AlertRule and defaults metadata.project", () => {
    const parsed = parseAlertResourceFile({
      path: "alerts/high-5xx.yaml",
      content: validRule.replace("  project: platform\n", ""),
    });

    expect(parsed.resource.kind).toBe("AlertRule");
    if (parsed.resource.kind !== "AlertRule") throw new Error("wrong kind");
    expect(parsed.resource.metadata.project).toBe("default");
    expect(parsed.resource.metadata.name).toBe("high-5xx-routes");
    expect(parsed.resource.spec.severity).toBe("critical");
  });

  it("parses a single AlertSettings resource", () => {
    const parsed = parseAlertResourceFiles([
      {
        path: "alerts/settings.yaml",
        content: `
kind: AlertSettings
spec:
  notificationDelivery:
    email:
      enabled: true
      to:
        - alerts@example.com
    telegram:
      enabled: false
      chatIds: []
`,
      },
    ]);

    expect(parsed.settings?.path).toBe("alerts/settings.yaml");
    expect(parsed.rules).toEqual([]);
  });

  it("rejects duplicate alert names within a project", () => {
    expect(() =>
      parseAlertResourceFiles([
        { path: "alerts/a.yaml", content: validRule },
        { path: "alerts/b.yaml", content: validRule },
      ]),
    ).toThrow(/Duplicate AlertRule metadata.name "high-5xx-routes" in project "platform"/);
  });

  it("allows the same alert name in different projects", () => {
    const parsed = parseAlertResourceFiles([
      { path: "alerts/a.yaml", content: validRule },
      {
        path: "alerts/b.yaml",
        content: validRule.replace("project: platform", "project: payments"),
      },
    ]);

    expect(parsed.rules.map((rule) => rule.resource.metadata.project)).toEqual([
      "platform",
      "payments",
    ]);
  });

  it("rejects unknown variables in summary, description, and query", () => {
    expect(() =>
      parseAlertResourceFile({
        path: "alerts/bad.yaml",
        content: validRule.replace("\${row_count}", "\${not_allowed}"),
      }),
    ).toThrow(/Unsupported alert variable "\${not_allowed}"/);
  });

  it("rejects evaluation intervals below one minute", () => {
    expect(() =>
      parseAlertResourceFile({
        path: "alerts/bad.yaml",
        content: validRule.replace("evaluationInterval: 1m", "evaluationInterval: 30s"),
      }),
    ).toThrow(/evaluationInterval must be at least 1m/);
  });
});
```

- [x] **Step 2: Run parser tests and verify they fail**

Run: `pnpm --filter @everr/app test:ci -- src/data/alerts/schema.test.ts`

Expected: FAIL because `packages/app/src/data/alerts/schema.ts` does not exist.

- [x] **Step 3: Add direct YAML parser dependencies**

Modify `packages/app/package.json`:

```json
"js-yaml": "^4.1.1"
```

under `dependencies`, and:

```json
"@types/js-yaml": "^4.0.9"
```

under `devDependencies`.

Run: `pnpm install --offline --filter @everr/app`

Expected: lockfile importer for `packages/app` includes `js-yaml` and `@types/js-yaml` without fetching from the network.

- [x] **Step 4: Implement the parser**

Create `packages/app/src/data/alerts/schema.ts`:

```ts
import { load } from "js-yaml";
import { z } from "zod";

const slugSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/, "must be a slug");

const durationSchema = z
  .string()
  .regex(/^[1-9][0-9]*(s|m|h|d)$/, "must be a duration such as 1m");

const alertVariableNames = new Set([
  "window",
  "row_count",
  "top_route",
  "top_error_count",
]);

function durationSeconds(value: string): number {
  const amount = Number.parseInt(value.slice(0, -1), 10);
  const unit = value.at(-1);
  if (unit === "s") return amount;
  if (unit === "m") return amount * 60;
  if (unit === "h") return amount * 60 * 60;
  if (unit === "d") return amount * 24 * 60 * 60;
  return Number.NaN;
}

function assertSupportedVariables(value: string, path: string) {
  for (const match of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    const name = match[1];
    if (!alertVariableNames.has(name)) {
      throw new Error(`Unsupported alert variable "\${${name}}" in ${path}.`);
    }
  }
}

const alertRuleSchema = z.object({
  kind: z.literal("AlertRule"),
  metadata: z.object({
    name: slugSchema,
    project: slugSchema.default("default"),
    previousName: slugSchema.optional(),
    labels: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.object({
    severity: z.enum(["critical", "warning"]),
    evaluationInterval: durationSchema.refine(
      (value) => durationSeconds(value) >= 60,
      "evaluationInterval must be at least 1m",
    ),
    window: durationSchema,
    summary: z.string().min(1),
    description: z.string().optional(),
    query: z.string().min(1),
  }),
});

const alertSettingsSchema = z.object({
  kind: z.literal("AlertSettings"),
  spec: z.object({
    notificationDelivery: z.object({
      email: z.object({
        enabled: z.boolean(),
        to: z.array(z.string().email()),
      }),
      telegram: z.object({
        enabled: z.boolean(),
        chatIds: z.array(z.string().min(1)),
      }),
    }),
  }),
});

const alertResourceSchema = z.discriminatedUnion("kind", [
  alertRuleSchema,
  alertSettingsSchema,
]);

export type AlertResource = z.infer<typeof alertResourceSchema>;
export type AlertRuleResource = z.infer<typeof alertRuleSchema>;

export type RawAlertResourceFile = {
  path: string;
  content: string;
};

export type ParsedAlertResource<T extends AlertResource = AlertResource> = {
  path: string;
  resource: T;
};

export function parseAlertResourceFile(
  file: RawAlertResourceFile,
): ParsedAlertResource {
  const loaded = load(file.content);
  const resource = alertResourceSchema.parse(loaded);
  if (resource.kind === "AlertRule") {
    assertSupportedVariables(resource.spec.summary, `${file.path}:summary`);
    if (resource.spec.description) {
      assertSupportedVariables(resource.spec.description, `${file.path}:description`);
    }
    assertSupportedVariables(resource.spec.query, `${file.path}:query`);
  }
  return { path: file.path, resource };
}

export function parseAlertResourceFiles(files: RawAlertResourceFile[]) {
  const parsed = files.map(parseAlertResourceFile);
  const rules: ParsedAlertResource<AlertRuleResource>[] = [];
  let settings: ParsedAlertResource | undefined;
  const seen = new Map<string, string>();

  for (const item of parsed) {
    if (item.resource.kind === "AlertSettings") {
      if (settings) {
        throw new Error(
          `Only one AlertSettings resource is allowed (${settings.path} and ${item.path}).`,
        );
      }
      settings = item;
      continue;
    }

    const key = `${item.resource.metadata.project}/${item.resource.metadata.name}`;
    const existing = seen.get(key);
    if (existing) {
      throw new Error(
        `Duplicate AlertRule metadata.name "${item.resource.metadata.name}" in project "${item.resource.metadata.project}" (${existing} and ${item.path}).`,
      );
    }
    seen.set(key, item.path);
    rules.push(item as ParsedAlertResource<AlertRuleResource>);
  }

  return { rules, settings };
}
```

- [x] **Step 5: Run parser tests and verify they pass**

Run: `pnpm --filter @everr/app test:ci -- src/data/alerts/schema.test.ts`

Expected: PASS.

## Task 2: Cloud Alert Test API Route

**Files:**
- Create: `packages/app/src/routes/api/cli/alerts/test.ts`
- Create: `packages/app/src/routes/api/cli/alerts/test.test.ts`

- [x] **Step 1: Add failing route tests**

Create `packages/app/src/routes/api/cli/alerts/test.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cliSessionContext, getRouteHandler } from "../-test-utils";

vi.mock("@/lib/clickhouse", () => ({
  querySqlApi: vi.fn(),
}));

import { querySqlApi } from "@/lib/clickhouse";
import { Route } from "./test";

const mockedQuerySqlApi = vi.mocked(querySqlApi);

type PostHandler = (args: {
  request: Request;
  context: ReturnType<typeof cliSessionContext>;
}) => Promise<Response>;

function postHandler(): PostHandler {
  return getRouteHandler<PostHandler>(Route, "POST", "/api/cli/alerts/test");
}

const body = {
  files: [
    {
      path: "alerts/high-5xx.yaml",
      content: `
kind: AlertRule
metadata:
  name: high-5xx-routes
  project: platform
spec:
  severity: critical
  evaluationInterval: 1m
  window: 5m
  summary: "\${row_count} routes have elevated 5xxs"
  query: "SELECT 1 AS ok"
`,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/alerts/test", () => {
  it("runs each AlertRule query through the tenant-scoped SQL API", async () => {
    mockedQuerySqlApi.mockResolvedValue([{ ok: 1 }]);

    const response = await postHandler()({
      request: new Request("http://localhost/api/cli/alerts/test", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      context: cliSessionContext("org-42"),
    });

    expect(response.status).toBe(200);
    expect(mockedQuerySqlApi).toHaveBeenCalledWith("SELECT 1 AS ok", "org-42");
    expect(await response.json()).toEqual({
      results: [
        {
          path: "alerts/high-5xx.yaml",
          project: "platform",
          name: "high-5xx-routes",
          severity: "critical",
          firing: true,
          rowCount: 1,
          truncated: false,
          evidence: [{ ok: 1 }],
        },
      ],
    });
  });

  it("returns firing false when the query returns no rows", async () => {
    mockedQuerySqlApi.mockResolvedValue([]);

    const response = await postHandler()({
      request: new Request("http://localhost/api/cli/alerts/test", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      context: cliSessionContext(),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).results[0]).toMatchObject({
      firing: false,
      rowCount: 0,
      evidence: [],
    });
  });

  it("returns 400 for invalid resources", async () => {
    const response = await postHandler()({
      request: new Request("http://localhost/api/cli/alerts/test", {
        method: "POST",
        body: JSON.stringify({ files: [{ path: "bad.yaml", content: "kind: Nope" }] }),
      }),
      context: cliSessionContext(),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.stringContaining("Invalid discriminator value"),
    });
    expect(mockedQuerySqlApi).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run route tests and verify they fail**

Run: `pnpm --filter @everr/app test:ci -- src/routes/api/cli/alerts/test.test.ts`

Expected: FAIL because the route does not exist.

- [x] **Step 3: Implement the route**

Create `packages/app/src/routes/api/cli/alerts/test.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { parseAlertResourceFiles } from "@/data/alerts/schema";
import { querySqlApi } from "@/lib/clickhouse";

const requestSchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      content: z.string(),
    }),
  ),
});

const MAX_EVIDENCE_ROWS = 50;

export const Route = createFileRoute("/api/cli/alerts/test")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        try {
          const body = requestSchema.parse(await request.json());
          const parsed = parseAlertResourceFiles(body.files);
          const results = [];

          for (const rule of parsed.rules) {
            const rows = await querySqlApi<Record<string, unknown>>(
              rule.resource.spec.query,
              context.session.session.activeOrganizationId,
            );
            const evidence = rows.slice(0, MAX_EVIDENCE_ROWS);
            results.push({
              path: rule.path,
              project: rule.resource.metadata.project,
              name: rule.resource.metadata.name,
              severity: rule.resource.spec.severity,
              firing: rows.length > 0,
              rowCount: rows.length,
              truncated: rows.length > MAX_EVIDENCE_ROWS,
              evidence,
            });
          }

          return Response.json({ results });
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to test alert resources.",
            },
            { status: 400 },
          );
        }
      },
    },
  },
});
```

- [x] **Step 4: Run route tests and verify they pass**

Run: `pnpm --filter @everr/app test:ci -- src/routes/api/cli/alerts/test.test.ts`

Expected: PASS.

## Task 3: Rust CLI Command

**Files:**
- Modify: `crates/everr-core/src/api.rs`
- Modify: `packages/desktop-app/src-cli/src/cli.rs`
- Modify: `packages/desktop-app/src-cli/src/core.rs`
- Modify: `packages/desktop-app/src-cli/src/main.rs`
- Modify: `packages/desktop-app/src-cli/tests/api_commands.rs`
- Modify: `packages/desktop-app/src-cli/tests/help_output.rs`

- [x] **Step 1: Add failing CLI tests**

Append tests to `packages/desktop-app/src-cli/tests/api_commands.rs`:

```rust
#[test]
fn alerts_test_posts_yaml_files_to_api() {
    let env = CliTestEnv::new();
    let repo_dir = env.home_dir.join("alerts-repo");
    std::fs::create_dir_all(repo_dir.join("alerts/nested")).expect("create alerts dir");
    std::fs::write(repo_dir.join("alerts/high-5xx.yaml"), "kind: AlertRule\n")
        .expect("write rule");
    std::fs::write(repo_dir.join("alerts/nested/settings.yml"), "kind: AlertSettings\n")
        .expect("write settings");
    std::fs::write(repo_dir.join("alerts/ignore.txt"), "ignored").expect("write ignored");
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("POST", "/api/cli/alerts/test")
        .match_header("authorization", "Bearer token-abc")
        .match_body(Matcher::AllOf(vec![
            Matcher::Regex("high-5xx\\.yaml".into()),
            Matcher::Regex("nested/settings\\.yml".into()),
            Matcher::Regex("AlertRule".into()),
            Matcher::Regex("AlertSettings".into()),
        ]))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"results":[{"path":"alerts/high-5xx.yaml","project":"default","name":"high-5xx","severity":"critical","firing":false,"rowCount":0,"truncated":false,"evidence":[]}]}"#)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args(["alerts", "test", "alerts"])
        .assert()
        .success()
        .stdout(contains("\"results\""));

    mock.assert();
}
```

Append to `packages/desktop-app/src-cli/tests/help_output.rs`:

```rust
#[test]
fn alerts_help_lists_test_command() {
    let env = CliTestEnv::new();

    env.command()
        .args(["alerts", "--help"])
        .assert()
        .success()
        .stdout(contains("test"));
}
```

- [x] **Step 2: Run CLI tests and verify they fail**

Run: `cargo test -p everr-cli alerts`

Expected: FAIL because `alerts` is not a known command.

- [x] **Step 3: Add API client types and method**

Modify `crates/everr-core/src/api.rs` with:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertResourceFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertsTestRequest {
    pub files: Vec<AlertResourceFile>,
}
```

and add:

```rust
pub async fn post_alerts_test(&self, request: &AlertsTestRequest) -> Result<Value> {
    let response = self
        .http
        .post(format!("{}/alerts/test", self.base_endpoint))
        .json(request)
        .send()
        .await
        .context("alerts test request failed")?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "<failed to read body>".to_string());
        return Err(http_status_error(status, text, "alerts test request"));
    }

    response
        .json::<Value>()
        .await
        .context("failed to decode alerts test response as JSON")
}
```

inside `impl ApiClient`.

- [x] **Step 4: Add CLI structs and dispatch**

Modify `packages/desktop-app/src-cli/src/cli.rs`:

```rust
Alerts(AlertsArgs),
```

in `Commands`, and define:

```rust
#[derive(Args, Debug)]
pub struct AlertsArgs {
    #[command(subcommand)]
    pub command: AlertsSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum AlertsSubcommand {
    /// Test alert resource files without persisting state
    Test(AlertsTestArgs),
}

#[derive(Args, Debug)]
pub struct AlertsTestArgs {
    /// Directory containing alert resource YAML files
    pub dir: std::path::PathBuf,
}
```

Modify `packages/desktop-app/src-cli/src/main.rs` to import `AlertsSubcommand` and dispatch:

```rust
Commands::Alerts(args) => match args.command {
    AlertsSubcommand::Test(args) => core::alerts_test(args).await?,
},
```

- [x] **Step 5: Implement file discovery and command**

Modify `packages/desktop-app/src-cli/src/core.rs` to import:

```rust
use everr_core::api::{AlertResourceFile, AlertsTestRequest};
```

and add:

```rust
pub async fn alerts_test(args: AlertsTestArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let files = discover_alert_resource_files(&args.dir)?;
    let response = client.post_alerts_test(&AlertsTestRequest { files }).await?;
    print_json(&response)?;
    Ok(())
}

fn discover_alert_resource_files(dir: &std::path::Path) -> Result<Vec<AlertResourceFile>> {
    if !dir.is_dir() {
        bail!("alert resource path is not a directory: {}", dir.display());
    }

    let mut files = Vec::new();
    collect_alert_resource_files(dir, dir, &mut files)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));

    if files.is_empty() {
        bail!("no alert resource files found in {}", dir.display());
    }

    Ok(files)
}

fn collect_alert_resource_files(
    root: &std::path::Path,
    dir: &std::path::Path,
    files: &mut Vec<AlertResourceFile>,
) -> Result<()> {
    for entry in std::fs::read_dir(dir).with_context(|| format!("read {}", dir.display()))? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_alert_resource_files(root, &path, files)?;
            continue;
        }

        let Some(ext) = path.extension().and_then(|value| value.to_str()) else {
            continue;
        };
        if ext != "yaml" && ext != "yml" {
            continue;
        }

        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace(std::path::MAIN_SEPARATOR, "/");
        let content = std::fs::read_to_string(&path)
            .with_context(|| format!("read alert resource {}", path.display()))?;
        files.push(AlertResourceFile {
            path: relative,
            content,
        });
    }

    Ok(())
}
```

- [x] **Step 6: Run CLI tests and verify they pass**

Run: `cargo test -p everr-cli alerts`

Expected: PASS.

## Task 4: Final Verification

**Files:**
- Verify all changed files.

- [x] **Step 1: Run app tests**

Run:

```bash
pnpm --filter @everr/app test:ci -- src/data/alerts/schema.test.ts src/routes/api/cli/alerts/test.test.ts
```

Expected: PASS.

- [x] **Step 2: Run Rust CLI tests**

Run:

```bash
cargo test -p everr-cli alerts
```

Expected: PASS.

- [x] **Step 3: Run typecheck for app**

Run:

```bash
pnpm --filter @everr/app typecheck
```

Expected: PASS.

- [x] **Step 4: Inspect git diff**

Run:

```bash
git diff --check
git status -sb
```

Expected: no whitespace errors; only intended alerting foundation files changed.

## Explicit Gaps For Follow-Up Branches

- `everr apply <dir>` reconciliation is not implemented here because this checkout lacks the shared as-code apply registry and auth middleware from the dashboard direction.
- Alert persistence, Graphile Worker scheduling, state transitions, notification delivery, and Alerts page UI are not implemented here.
- `alerts test --local` is not implemented here because the existing local telemetry query path is CLI-local and this slice only adds the cloud-backed test route.
