# Gitops Dashboards — CLI (`everr dashboards apply`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `everr dashboards apply <dir> --source=<id> [--dry-run]` so a repo of Perses YAML/JSON dashboards can be reconciled into everr from CI or a developer machine — completing the gitops loop.

**Architecture:** Expose the existing source-scoped reconcile over a dedicated REST route `POST /api/dashboards/apply`, guarded by the API-key-or-session middleware built in plan 2. The Rust CLI walks a directory, parses each YAML/JSON dashboard into a JSON document, and POSTs the batch with a bearer token (the interactive device session, or `EVERR_API_TOKEN` in CI). The reconcile core is shared between the route and is the same logic the Core plan unit-tested.

**Tech Stack:** TypeScript (TanStack Start route handlers, Zod, Drizzle), Rust (`everr-cli`: clap, reqwest, serde_json, serde_yaml, walkdir), Vitest, `cargo test`.

**Scope note:** Plan 3 of 3. Locked decision: **`apply` only** — no `list`, no `delete` (deletion is declarative: remove the file and re-apply). Builds directly on Core (reconcile, `applyDashboardsInput`, schema) and plan 2 (`resolveApplyAuth`, `requireOrgOrApiKeyMiddleware`, `buildApplyContext`).

---

## Background (existing code this builds on)

- **Core:** `applyDashboards` is currently a TanStack **server function** in `packages/app/src/data/dashboards/server.ts`. Its handler: `buildDesiredSet(documents)` → load the source's existing dashboards (`org + source`) → `reconcile({existing, desired})` → if `dryRun` return summary, else apply creates/updates/deletes in a `db.transaction`. It returns `{ created: string[], updated: string[], deleted: string[], dryRun: boolean }`. The input schema is `applyDashboardsInput` in `data/dashboards/schema.ts` (`{ source, documents: {path, document}[], dryRun? }`). **This server function currently has no caller** (the UI is read-only) — it exists for the CLI.
- **Plan 2:** `requireOrgOrApiKeyMiddleware` (in `packages/app/src/lib/serverFn.ts`) authenticates a request via an API key (`Authorization: Bearer` / `x-api-key`, ingest config) and falls back to the interactive session, producing `context.session.session.activeOrganizationId`. It was built with `createMiddleware().server(...)` — the same form as `requireOrgMiddleware`, which `routes/api/cli.ts` already uses as a **route** `server.middleware`. So `requireOrgOrApiKeyMiddleware` works as a route middleware too. Plan 2 currently keeps it **un-exported** and wraps it in `createApplyServerFn`.
- **CLI:** `packages/desktop-app/src-cli` (Rust). Commands are declared in `src/cli.rs` (clap) and dispatched in `src/main.rs` (`match cli.command`). The HTTP client `ApiClient` lives in `crates/everr-core/src/api.rs`; `ApiClient::from_session(&session)` sets `Authorization: Bearer <session.token>` and `base_endpoint = {api_base_url}/api/cli`. Session/state load via `crates/everr-core/src/state.rs` (`AppState`/`Session`, with `api_base_url` + `token`). The CLI Cargo manifest is `packages/desktop-app/src-cli/Cargo.toml` (has `serde_json`, `reqwest`, `clap`, `anyhow`, `tokio`; **no** `serde_yaml`/`walkdir` yet).
- **`/api/cli` routes are session-only** (wrapped by `requireOrgMiddleware`). The apply route must accept API keys, so it lives at **`/api/dashboards/apply`** (outside `/api/cli`) with its own middleware — not under `/api/cli`.

---

## File Structure

**New files:**
- `packages/app/src/routes/api/dashboards/apply.ts` — REST route `POST /api/dashboards/apply`.
- `packages/app/src/routes/api/dashboards/apply.test.ts` — route handler tests.
- `crates/everr-core/src/dashboards.rs` — CLI-side dashboard file loader + apply request/response types + `ApiClient::apply_dashboards`.

**Modified files:**
- `packages/app/src/data/dashboards/server.ts` — extract `applyDashboardSpecs` core; remove the `applyDashboards` server fn.
- `packages/app/src/data/dashboards/server.test.ts` — point apply tests at `applyDashboardSpecs`.
- `packages/app/src/lib/serverFn.ts` — export `requireOrgOrApiKeyMiddleware`; remove the now-unused `createApplyServerFn`.
- `crates/everr-core/src/api.rs` — `apply_dashboards` method + `ApiClient::from_token`.
- `crates/everr-core/src/lib.rs` — `pub mod dashboards;` (if modules are declared there).
- `packages/desktop-app/src-cli/Cargo.toml` — add `serde_yaml` and `walkdir`.
- `packages/desktop-app/src-cli/src/cli.rs` — `Dashboards` command + `apply` subcommand.
- `packages/desktop-app/src-cli/src/main.rs` — dispatch `Commands::Dashboards`.
- `packages/desktop-app/src-cli/src/core.rs` — `run_dashboards_apply` handler.

---

## Task 1: Extract `applyDashboardSpecs` core (server refactor, no behavior change)

Pull the apply logic out of the server-fn handler into a plain function the REST route can call.

**Files:**
- Modify: `packages/app/src/data/dashboards/server.ts`
- Modify: `packages/app/src/data/dashboards/server.test.ts`

- [ ] **Step 1: Read the current `applyDashboards` handler**

Run: `cd packages/app && rg -n "applyDashboards|buildDesiredSet|reconcile|db.transaction" src/data/dashboards/server.ts`
Confirm the handler body (desired set → load existing by org+source → reconcile → dryRun early return → transactional create/update/delete → return summary).

- [ ] **Step 2: Add the extracted core function**

In `server.ts`, add this exported function (place it near `applyDashboards`). It is the current handler body with `orgId` passed in instead of read from context:

```typescript
export interface ApplyDashboardsResult {
  created: string[];
  updated: string[];
  deleted: string[];
  dryRun: boolean;
}

/**
 * Source-scoped declarative reconcile core, shared by the apply route. Loads
 * ONLY the given source's dashboards, diffs against the desired documents, and
 * (unless dryRun) applies creates/updates/deletes in a single transaction.
 */
export async function applyDashboardSpecs(opts: {
  orgId: string;
  source: string;
  documents: { path: string; document: unknown }[];
  dryRun?: boolean;
}): Promise<ApplyDashboardsResult> {
  const { orgId, source, documents, dryRun } = opts;

  const desired = buildDesiredSet(documents);

  const existing = await db
    .select({
      slug: dashboards.slug,
      folderPath: dashboards.folderPath,
      spec: dashboards.spec,
    })
    .from(dashboards)
    .where(
      and(eq(dashboards.organizationId, orgId), eq(dashboards.source, source)),
    );

  const diff = reconcile({ existing, desired });

  const summary: ApplyDashboardsResult = {
    created: diff.creates.map((d) => d.slug),
    updated: diff.updates.map((d) => d.slug),
    deleted: diff.deletes,
    dryRun: dryRun ?? false,
  };

  if (dryRun) return summary;

  await db.transaction(async (tx) => {
    for (const d of diff.creates) {
      await tx.insert(dashboards).values({
        organizationId: orgId,
        source,
        slug: d.slug,
        folderPath: d.folderPath,
        spec: d.spec as DashboardSpec,
      });
    }
    for (const d of diff.updates) {
      await tx
        .update(dashboards)
        .set({
          spec: d.spec as DashboardSpec,
          folderPath: d.folderPath,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(dashboards.organizationId, orgId),
            eq(dashboards.source, source),
            eq(dashboards.slug, d.slug),
          ),
        );
    }
    for (const slug of diff.deletes) {
      await tx
        .delete(dashboards)
        .where(
          and(
            eq(dashboards.organizationId, orgId),
            eq(dashboards.source, source),
            eq(dashboards.slug, slug),
          ),
        );
    }
  });

  return summary;
}
```

- [ ] **Step 3: Remove the `applyDashboards` server fn (the route replaces it)**

Delete the `export const applyDashboards = createApplyServerFn(...)...` definition from `server.ts`, and remove `createApplyServerFn` from the `@/lib/serverFn` import (keep `createAuthenticatedServerFn`). Keep the `applyDashboardsInput` import only if still used here — it is NOT used by the core function, so remove it from `server.ts`'s imports if nothing else references it (the route in Task 2 will import it). Keep `buildDesiredSet`, `reconcile`, `and`, `eq`, `db`, `dashboards`, `DashboardSpec`.

- [ ] **Step 4: Repoint the apply tests at the core function**

In `server.test.ts`, the three `applyDashboards` tests call `applyDashboards({ data: { ... } })`. Change them to call `applyDashboardSpecs({ orgId: "org-1", source, documents, dryRun })` directly (no `data` wrapper, pass `orgId` explicitly). Update the import from `./server` (`applyDashboards` → `applyDashboardSpecs`). The assertions on `{ created, updated, deleted, dryRun }` and `mockedDb.transaction` calls stay the same. Example for the dryRun test:

```typescript
const result = await applyDashboardSpecs({
  orgId: "org-1",
  source: "team",
  dryRun: true,
  documents: [
    {
      path: "new.yaml",
      document: { kind: "Dashboard", metadata: { name: "new" }, spec: { panels: {}, layouts: [] } },
    },
  ],
});
expect(result).toEqual({ created: ["new"], updated: [], deleted: ["old"], dryRun: true });
expect(mockedDb.transaction).not.toHaveBeenCalled();
```

- [ ] **Step 5: Run the tests**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `cd packages/app && pnpm exec tsc --noEmit 2>&1 | rg "data/dashboards/server.ts" || echo "no server.ts errors"`
Expected: "no server.ts errors". (serverFn.ts may now report `createApplyServerFn` unused — fixed in Task 2.)

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/data/dashboards/server.ts packages/app/src/data/dashboards/server.test.ts
git commit -m "refactor(dashboards): extract applyDashboardSpecs core"
```
If the fallow pre-commit hook flags `createApplyServerFn`/`requireOrgOrApiKeyMiddleware` as unused (because the server fn that used them is gone), that is resolved in Task 2 — STOP and report so the controller can land Tasks 1+2 together (do NOT bypass).

---

## Task 2: `POST /api/dashboards/apply` route

**Files:**
- Create: `packages/app/src/routes/api/dashboards/apply.ts`
- Test: `packages/app/src/routes/api/dashboards/apply.test.ts`
- Modify: `packages/app/src/lib/serverFn.ts`

- [ ] **Step 1: Export the middleware; drop the unused factory**

In `serverFn.ts`: change `const requireOrgOrApiKeyMiddleware = ...` back to `export const requireOrgOrApiKeyMiddleware = ...`. Remove `export const createApplyServerFn = createServerFn().middleware([requireOrgOrApiKeyMiddleware]);` (no longer used — the route uses the middleware directly). Keep `buildApplyContext` exported. If `createServerFn` becomes unused after this removal, also drop it from the imports (it's still used by `createAuthenticatedServerFn`/`createPartiallyAuthenticatedServerFn` — verify with `rg -n "createServerFn" src/lib/serverFn.ts` and keep it if still referenced).

- [ ] **Step 2: Write the failing route test**

```typescript
// packages/app/src/routes/api/dashboards/apply.test.ts
import { describe, expect, it, vi } from "vitest";

const applyDashboardSpecs = vi.fn();
vi.mock("@/data/dashboards/server", () => ({
  applyDashboardSpecs: (...a: unknown[]) => applyDashboardSpecs(...a),
}));

import { Route } from "./apply";

// The route's POST handler receives { request, context }. context.session is
// provided by requireOrgOrApiKeyMiddleware; we supply it directly here.
const POST = Route.options.server.handlers.POST as (args: {
  request: Request;
  context: { session: { session: { activeOrganizationId: string } } };
}) => Promise<Response>;

const ctx = { session: { session: { activeOrganizationId: "org-1" } } };

function req(body: unknown): Request {
  return new Request("http://x/api/dashboards/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/dashboards/apply", () => {
  it("applies and returns the summary", async () => {
    applyDashboardSpecs.mockResolvedValueOnce({
      created: ["cpu"], updated: [], deleted: [], dryRun: false,
    });
    const res = await POST({
      request: req({
        source: "team",
        documents: [
          { path: "cpu.yaml", document: { kind: "Dashboard", metadata: { name: "cpu" }, spec: { panels: {}, layouts: [] } } },
        ],
      }),
      context: ctx,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: ["cpu"], updated: [], deleted: [], dryRun: false });
    expect(applyDashboardSpecs).toHaveBeenCalledWith({
      orgId: "org-1",
      source: "team",
      documents: [
        { path: "cpu.yaml", document: { kind: "Dashboard", metadata: { name: "cpu" }, spec: { panels: {}, layouts: [] } } },
      ],
      dryRun: undefined,
    });
  });

  it("returns 400 on an invalid body", async () => {
    const res = await POST({ request: req({ documents: [] }), context: ctx });
    expect(res.status).toBe(400);
    expect(applyDashboardSpecs).not.toHaveBeenCalled();
  });

  it("returns 400 when applyDashboardSpecs throws (e.g. invalid document)", async () => {
    applyDashboardSpecs.mockRejectedValueOnce(new Error("bad.yaml: invalid dashboard spec"));
    const res = await POST({
      request: req({ source: "team", documents: [{ path: "bad.yaml", document: {} }] }),
      context: ctx,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/bad\.yaml/);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/routes/api/dashboards/apply.test.ts`
Expected: FAIL — route missing.

- [ ] **Step 4: Implement the route**

```typescript
// packages/app/src/routes/api/dashboards/apply.ts
import { createFileRoute } from "@tanstack/react-router";
import { applyDashboardSpecs } from "@/data/dashboards/server";
import { applyDashboardsInput } from "@/data/dashboards/schema";
import { requireOrgOrApiKeyMiddleware } from "@/lib/serverFn";

export const Route = createFileRoute("/api/dashboards/apply")({
  server: {
    middleware: [requireOrgOrApiKeyMiddleware],
    handlers: {
      POST: async ({ request, context }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const parsed = applyDashboardsInput.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.issues[0]?.message ?? "Invalid request" },
            { status: 400 },
          );
        }

        try {
          const summary = await applyDashboardSpecs({
            orgId: context.session.session.activeOrganizationId,
            source: parsed.data.source,
            documents: parsed.data.documents,
            dryRun: parsed.data.dryRun,
          });
          return Response.json(summary);
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error ? error.message : "Failed to apply dashboards",
            },
            { status: 400 },
          );
        }
      },
    },
  },
});
```

- [ ] **Step 5: Run the route tests**

Run: `cd packages/app && pnpm exec vitest run src/routes/api/dashboards/apply.test.ts`
Expected: PASS. If `Route.options.server.handlers.POST` is not the correct access path for a TanStack route's handler in this version, inspect an existing route test (e.g. `src/routes/api/cli/sql.test.ts`) for how it invokes the handler and mirror that exact access pattern in the test.

- [ ] **Step 6: Full server suite + typecheck**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards src/lib src/routes/api/dashboards && pnpm exec tsc --noEmit 2>&1 | rg "serverFn|dashboards" || echo clean`
Expected: tests PASS; "clean".

- [ ] **Step 7: Commit (Tasks 1+2 together if fallow required it)**

```bash
git add packages/app/src/routes/api/dashboards/apply.ts packages/app/src/routes/api/dashboards/apply.test.ts packages/app/src/lib/serverFn.ts
git commit -m "feat(dashboards): POST /api/dashboards/apply route"
```

---

## Task 3: CLI dashboard file loader

Walk a directory and parse each `.yaml`/`.yml`/`.json` file into `{ path, document }`, where `path` is the POSIX-relative path and `document` is parsed JSON (YAML is parsed then converted to `serde_json::Value`).

**Files:**
- Modify: `packages/desktop-app/src-cli/Cargo.toml`
- Create: `crates/everr-core/src/dashboards.rs`
- Modify: `crates/everr-core/src/lib.rs` (add `pub mod dashboards;`)

NOTE: the loader lives in `everr-core` (where `api.rs` is) so the API method and types share it. Confirm where `api.rs`'s module is declared (`crates/everr-core/src/lib.rs`) and add the new module there. The `Cargo.toml` deps go in whichever crate compiles `dashboards.rs` — that is `crates/everr-core/Cargo.toml`. Add `serde_yaml` and `walkdir` to **`crates/everr-core/Cargo.toml`** (not the src-cli one) unless the loader is placed in src-cli; keep the loader in everr-core and add deps there.

- [ ] **Step 1: Add dependencies**

In `crates/everr-core/Cargo.toml` `[dependencies]`, add:
```toml
serde_yaml = "0.9"
walkdir = "2.5"
```
(If `crates/everr-core/Cargo.toml` already pins different versions of serde/serde_json, leave those; only add the two missing crates.)

- [ ] **Step 2: Write the failing test**

Create `crates/everr-core/src/dashboards.rs` with the test module first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn loads_yaml_and_json_with_relative_posix_paths() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("team")).unwrap();
        fs::write(
            dir.path().join("team/cpu.yaml"),
            "kind: Dashboard\nmetadata:\n  name: cpu\nspec:\n  panels: {}\n  layouts: []\n",
        )
        .unwrap();
        fs::write(
            dir.path().join("mem.json"),
            r#"{"kind":"Dashboard","metadata":{"name":"mem"},"spec":{"panels":{},"layouts":[]}}"#,
        )
        .unwrap();

        let mut docs = load_dashboard_documents(dir.path()).unwrap();
        docs.sort_by(|a, b| a.path.cmp(&b.path));

        assert_eq!(docs.len(), 2);
        assert_eq!(docs[0].path, "mem.json");
        assert_eq!(docs[1].path, "team/cpu.yaml");
        assert_eq!(docs[1].document["metadata"]["name"], "cpu");
        assert_eq!(docs[1].document["spec"]["layouts"], serde_json::json!([]));
    }

    #[test]
    fn ignores_non_dashboard_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("README.md"), "# not a dashboard").unwrap();
        let docs = load_dashboard_documents(dir.path()).unwrap();
        assert!(docs.is_empty());
    }

    #[test]
    fn errors_with_filename_on_invalid_yaml() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("broken.yaml"), "key: : :\n  - bad").unwrap();
        let err = load_dashboard_documents(dir.path()).unwrap_err();
        assert!(err.to_string().contains("broken.yaml"), "error was: {err}");
    }
}
```

If `tempfile` is not already a dev-dependency of `everr-core`, add it under `[dev-dependencies]` in `crates/everr-core/Cargo.toml`: `tempfile = "3"`.

- [ ] **Step 3: Run to verify it fails**

Run: `cargo test -p everr-core dashboards`
Expected: FAIL — `load_dashboard_documents` missing.

- [ ] **Step 4: Implement the loader**

Prepend to `crates/everr-core/src/dashboards.rs` (above the test module):

```rust
use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use walkdir::WalkDir;

/// A dashboard document discovered on disk: its repo-relative POSIX path and
/// parsed JSON contents.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DashboardDocument {
    pub path: String,
    pub document: Value,
}

fn is_dashboard_file(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()),
        Some("yaml") | Some("yml") | Some("json")
    )
}

fn parse_document(path: &Path, contents: &str) -> Result<Value> {
    let is_json = path.extension().and_then(|e| e.to_str()) == Some("json");
    if is_json {
        serde_json::from_str(contents).map_err(anyhow::Error::from)
    } else {
        // serde_yaml deserializes into serde_json::Value fine (YAML is a JSON
        // superset for our document shape).
        serde_yaml::from_str(contents).map_err(anyhow::Error::from)
    }
}

/// Recursively load every `.yaml`/`.yml`/`.json` dashboard under `dir`,
/// returning each with its POSIX path relative to `dir`. Errors name the file.
pub fn load_dashboard_documents(dir: &Path) -> Result<Vec<DashboardDocument>> {
    let mut out = Vec::new();
    for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !entry.file_type().is_file() || !is_dashboard_file(path) {
            continue;
        }
        let rel = path
            .strip_prefix(dir)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        let contents = std::fs::read_to_string(path)
            .with_context(|| format!("{rel}: failed to read file"))?;
        let document = parse_document(path, &contents)
            .with_context(|| format!("{rel}: failed to parse"))?;
        out.push(DashboardDocument { path: rel, document });
    }
    Ok(out)
}
```

- [ ] **Step 5: Declare the module**

In `crates/everr-core/src/lib.rs`, add `pub mod dashboards;` alongside the other `pub mod` lines (run `rg -n "pub mod" crates/everr-core/src/lib.rs` to see the list and match the style).

- [ ] **Step 6: Run the tests**

Run: `cargo test -p everr-core dashboards`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add crates/everr-core/Cargo.toml crates/everr-core/src/dashboards.rs crates/everr-core/src/lib.rs Cargo.lock
git commit -m "feat(cli): load dashboard documents from a directory"
```

---

## Task 4: `ApiClient::apply_dashboards` + token construction

**Files:**
- Modify: `crates/everr-core/src/api.rs`
- Modify: `crates/everr-core/src/dashboards.rs` (request/response types)

- [ ] **Step 1: Add request/response types to `dashboards.rs`**

Append (above the test module):

```rust
#[derive(Debug, Clone, Serialize)]
pub struct ApplyDashboardsRequest {
    pub source: String,
    pub documents: Vec<DashboardDocument>,
    #[serde(rename = "dryRun", skip_serializing_if = "std::ops::Not::not")]
    pub dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ApplyDashboardsSummary {
    pub created: Vec<String>,
    pub updated: Vec<String>,
    pub deleted: Vec<String>,
    #[serde(rename = "dryRun")]
    pub dry_run: bool,
}
```

- [ ] **Step 2: Add the `apply_dashboards` method to `ApiClient`**

In `api.rs`, add a method on `impl ApiClient` (note: posts to `base_url + "/api/dashboards/apply"`, NOT `base_endpoint`):

```rust
pub async fn apply_dashboards(
    &self,
    request: &crate::dashboards::ApplyDashboardsRequest,
) -> Result<crate::dashboards::ApplyDashboardsSummary> {
    let response = self
        .http
        .post(format!("{}/api/dashboards/apply", self.base_url))
        .json(request)
        .send()
        .await
        .context("dashboards apply request failed")?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "<failed to read body>".to_string());
        return Err(http_status_error(status, text, "dashboards apply"));
    }

    response
        .json()
        .await
        .context("failed to decode dashboards apply response")
}
```

(`http_status_error` and the `http`/`base_url` fields already exist in `api.rs`. If `base_url` is private and unused outside `from_session`, it is already a struct field — reuse it directly.)

- [ ] **Step 3: Add a token-based constructor**

In `api.rs`, add alongside `from_session`:

```rust
/// Build a client from a raw bearer token + base URL (for CI: `EVERR_API_TOKEN`).
pub fn from_token(api_base_url: &str, token: &str) -> Result<Self> {
    let mut headers = HeaderMap::new();
    let bearer = format!("Bearer {token}");
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&bearer).context("invalid token for Authorization header")?,
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    let http = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .context("failed to build HTTP client")?;
    let base_url = api_base_url.trim_end_matches('/').to_string();
    let base_endpoint = format!("{base_url}/api/cli");
    Ok(Self { http, base_url, base_endpoint })
}
```

- [ ] **Step 4: Build the workspace + run core tests**

Run: `cargo build -p everr-core && cargo test -p everr-core dashboards`
Expected: builds; tests PASS. Fix any field-visibility issues (e.g. if `Self { http, base_url, base_endpoint }` can't be constructed because fields are private to the impl — they're in the same module, so it's fine).

- [ ] **Step 5: Commit**

```bash
git add crates/everr-core/src/api.rs crates/everr-core/src/dashboards.rs
git commit -m "feat(cli): apply_dashboards api client + token constructor"
```

---

## Task 5: CLI command wiring (`everr dashboards apply`)

**Files:**
- Modify: `packages/desktop-app/src-cli/src/cli.rs`
- Modify: `packages/desktop-app/src-cli/src/main.rs`
- Modify: `packages/desktop-app/src-cli/src/core.rs`

- [ ] **Step 1: Add the clap command**

In `cli.rs`, add to the `Commands` enum (match the existing doc-comment style):

```rust
    /// Apply a directory of dashboard definitions (gitops)
    Dashboards(DashboardsArgs),
```

And add the arg structs (near the other `*Args`):

```rust
#[derive(Args, Debug)]
pub struct DashboardsArgs {
    #[command(subcommand)]
    pub command: DashboardsSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum DashboardsSubcommand {
    /// Reconcile a directory of dashboard files into Everr
    Apply(DashboardsApplyArgs),
}

#[derive(Args, Debug)]
pub struct DashboardsApplyArgs {
    /// Directory containing dashboard YAML/JSON files
    pub dir: String,
    /// Source id that owns these dashboards (prune scope)
    #[arg(long)]
    pub source: String,
    /// Compute and print the diff without writing
    #[arg(long = "dry-run")]
    pub dry_run: bool,
}
```

- [ ] **Step 2: Dispatch in `main.rs`**

In the `match cli.command` block, add:

```rust
        Commands::Dashboards(args) => match args.command {
            cli::DashboardsSubcommand::Apply(apply_args) => {
                core::run_dashboards_apply(apply_args).await?
            }
        },
```

(Match the existing arm style; `cli::` prefix as used by neighboring arms — check how other subcommands are referenced in main.rs and mirror it.)

- [ ] **Step 3: Implement the handler in `core.rs`**

Add (mirror how other `core.rs` handlers load the session — `rg -n "from_session|load_state|fn run_" packages/desktop-app/src-cli/src/core.rs` to copy the exact session-loading helper):

```rust
pub async fn run_dashboards_apply(args: crate::cli::DashboardsApplyArgs) -> anyhow::Result<()> {
    use everr_core::dashboards::{load_dashboard_documents, ApplyDashboardsRequest};

    let dir = std::path::Path::new(&args.dir);
    if !dir.is_dir() {
        anyhow::bail!("{} is not a directory", args.dir);
    }
    let documents = load_dashboard_documents(dir)?;
    if documents.is_empty() {
        eprintln!(
            "warning: no dashboard files (.yaml/.yml/.json) found under {}",
            args.dir
        );
    }

    // CI: EVERR_API_TOKEN (+ EVERR_API_URL or a persisted base URL). Otherwise
    // use the interactive device session.
    let client = match std::env::var("EVERR_API_TOKEN").ok().filter(|t| !t.is_empty()) {
        Some(token) => {
            let base_url = std::env::var("EVERR_API_URL").ok().or_else(persisted_api_base_url)
                .ok_or_else(|| anyhow::anyhow!(
                    "EVERR_API_TOKEN is set but no base URL; set EVERR_API_URL"
                ))?;
            everr_core::api::ApiClient::from_token(&base_url, &token)?
        }
        None => {
            let session = load_session()?;
            everr_core::api::ApiClient::from_session(&session)?
        }
    };

    let request = ApplyDashboardsRequest {
        source: args.source,
        documents,
        dry_run: args.dry_run,
    };
    let summary = client.apply_dashboards(&request).await?;

    let label = if summary.dry_run { "(dry run) " } else { "" };
    println!(
        "{label}applied source: {} created, {} updated, {} deleted",
        summary.created.len(),
        summary.updated.len(),
        summary.deleted.len()
    );
    for s in &summary.created { println!("  + {s}"); }
    for s in &summary.updated { println!("  ~ {s}"); }
    for s in &summary.deleted { println!("  - {s}"); }
    Ok(())
}
```

Two helpers this references — implement to match the codebase:
- `load_session()` — use the SAME session-loading code the other `core.rs` handlers use before `ApiClient::from_session`. If they inline it (e.g. `let session = some_store.load_session()?;`), extract it into a small `fn load_session() -> Result<Session>` or inline the identical lines here. Do NOT invent a new mechanism.
- `persisted_api_base_url() -> Option<String>` — read `api_base_url` from the persisted `AppState`/`Session` via the same store the CLI already uses (see `crates/everr-core/src/state.rs`); return `None` if no state/session exists. If reading persisted state without a full session is awkward, it's acceptable for `persisted_api_base_url` to load the session and return its `api_base_url`, falling back to `None` on error.

- [ ] **Step 4: Build the CLI**

Run: `cargo build -p everr-cli` (or the CLI package name — check `packages/desktop-app/src-cli/Cargo.toml` `[package] name`; it may be `everr-cli`).
Expected: compiles. Fix arm/style mismatches reported by the compiler.

- [ ] **Step 5: Verify the command parses**

Run: `cargo run -p everr-cli -- dashboards apply --help`
Expected: help text shows `<DIR>`, `--source`, `--dry-run`.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop-app/src-cli/src/cli.rs packages/desktop-app/src-cli/src/main.rs packages/desktop-app/src-cli/src/core.rs Cargo.lock
git commit -m "feat(cli): everr dashboards apply command"
```

---

## Task 6: End-to-end smoke

Drive the real CLI against the running dev server with a real ingest key and a sample dashboard directory.

- [ ] **Step 1: Prepare a sample dashboard directory**

```bash
mkdir -p /tmp/dash/team
cat > /tmp/dash/team/cpu.yaml <<'EOF'
kind: Dashboard
metadata:
  name: cli-cpu
spec:
  panels: {}
  layouts: []
EOF
```

- [ ] **Step 2: Get an ingest key + base URL**

Use the `gitops-smoke` ingest key already minted in the dev DB (plan 2), or mint a fresh one via the Ingest Keys page. The dev base URL is `http://localhost:5173`.

- [ ] **Step 3: Dry-run apply with the token**

```bash
EVERR_API_TOKEN='ek_...' EVERR_API_URL='http://localhost:5173' \
  cargo run -p everr-cli -- dashboards apply /tmp/dash --source demo-cli --dry-run
```
Expected: prints `(dry run) ... 1 created` (cli-cpu) and exits 0 — proving file loading, the bearer token, the route, and the reconcile diff all work end to end. If the apply route's middleware returns a non-2xx for a valid key, debug: confirm `requireOrgOrApiKeyMiddleware` is the route middleware and that a thrown auth error maps to a sensible status (check how `requireOrgMiddleware` errors surface for `/api/cli`).

- [ ] **Step 4: Real apply, then verify + idempotency**

```bash
EVERR_API_TOKEN='ek_...' EVERR_API_URL='http://localhost:5173' \
  cargo run -p everr-cli -- dashboards apply /tmp/dash --source demo-cli
```
Expected: `1 created`. Verify the row: `docker exec everr-postgres-1 psql -U postgres -d postgres -c "select source, slug, folder_path from dashboards where source='demo-cli';"` → `demo-cli | cli-cpu | team`. Run the same apply again → `0 created, 0 updated, 0 deleted` (idempotent).

- [ ] **Step 5: Delete-by-default via git semantics**

```bash
rm /tmp/dash/team/cpu.yaml
EVERR_API_TOKEN='ek_...' EVERR_API_URL='http://localhost:5173' \
  cargo run -p everr-cli -- dashboards apply /tmp/dash --source demo-cli
```
Expected: `1 deleted` (cli-cpu). Confirm the row is gone in psql. This proves the full gitops loop including declarative deletion (the reason no `delete` command is needed).

- [ ] **Step 6: Clean up**

```bash
docker exec everr-postgres-1 psql -U postgres -d postgres -c "delete from dashboards where source='demo-cli';"
```
(Should already be empty after Step 5; harmless.)

- [ ] **Step 7: Commit any fixes found during smoke**

```bash
git add -A && git commit -m "fix(cli): address dashboards apply smoke findings"
```
(Skip if nothing needed fixing.)

---

## Self-Review Notes (plan vs. locked decisions)

- **`apply` only:** one command, no `list`/`delete` — Task 5. Deletion is declarative (Task 6 Step 5 proves it).
- **Reads YAML and JSON, directory = folder:** Task 3 loader (folder path is the relative directory, sent as `path`; the server's `buildDesiredSet` derives the folder from it — already built in Core).
- **Sends a bearer token (session or `EVERR_API_TOKEN`):** Task 4 (`from_token`) + Task 5 (env selection).
- **Reuses plan 2 auth:** the route uses `requireOrgOrApiKeyMiddleware` — Task 2. No new auth code.
- **Reuses Core reconcile:** `applyDashboardSpecs` is the Core handler body extracted — Task 1; the route is a thin transport.
- **No server fn left dangling:** the unused `applyDashboards` server fn and `createApplyServerFn` are removed (the REST route is the single apply entrypoint) — Tasks 1–2.
- **`--dry-run`:** plumbed CLI → request → route → core — Tasks 3/5/2/1; smoked in Task 6 Step 3.
- **Deferred:** webhook sync ("A later") and a repo-root `everr-dashboards.yaml` manifest (the `--source` flag is required for now) — not in this plan.
