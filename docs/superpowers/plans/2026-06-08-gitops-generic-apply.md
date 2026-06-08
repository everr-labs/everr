# Gitops — Generic `everr apply` (kind registry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the just-built dashboard apply into a resource-generic `everr apply <dir> --source=<id>` so future kinds (alerts, …) are added server-side without changing the CLI.

**Architecture:** One `POST /api/apply` endpoint receives all documents, groups them by their `kind` field, and dispatches each group to a reconciler in a server-side registry (`{ Dashboard: <dashboard reconciler> }`). Each reconciler is the source-scoped declarative reconcile for its kind. The endpoint reconciles **every registered kind** for the source (a kind absent from the tree is pruned), and returns a per-kind summary. The Rust CLI loads all `.yaml/.yml/.json` files and POSTs them — it is kind-agnostic and never changes when a kind is added.

**Tech Stack:** TypeScript (TanStack Start route, Zod, Drizzle), Rust (`everr-cli`/`everr-core`), Vitest, `cargo test`.

**Scope note:** This refactors the output of the CLI plan (which added `everr dashboards apply` + `/api/dashboards/apply`). Nothing is merged/in production, so renames are free. No alert reconciler is built here — only the seam. Locked decisions: server-side kind registry; `everr apply` top-level command; a source owns all registered kinds (complete-tree-per-source; use separate sources to isolate kinds); unknown kind → error.

---

## Background (current state, post-CLI-plan)

- `packages/app/src/data/dashboards/server.ts` exports `applyDashboardSpecs({ orgId, source, documents, dryRun }): Promise<{created, updated, deleted, dryRun}>` — the dashboard reconcile core (source-scoped, transactional, delete-by-default). `documents` is `{ path: string; document: unknown }[]`.
- `packages/app/src/data/dashboards/schema.ts` exports `applyDashboardsInput` (`{ source, documents: {path, document}[], dryRun? }`).
- `packages/app/src/routes/api/dashboards/apply.ts` — `POST /api/dashboards/apply`, middleware `requireOrgOrApiKeyMiddleware`, validates with `applyDashboardsInput`, calls `applyDashboardSpecs`, returns its summary.
- `packages/app/src/lib/serverFn.ts` exports `requireOrgOrApiKeyMiddleware`.
- Rust `crates/everr-core/src/dashboards.rs`: `DashboardDocument { path, document: Value }`, `load_dashboard_documents(dir)`, `ApplyDashboardsRequest { source, documents, dry_run }`, `ApplyDashboardsSummary { created, updated, deleted, dry_run }`. `crates/everr-core/src/api.rs`: `ApiClient::apply_dashboards` (POST `{base_url}/api/dashboards/apply`) + `from_token`.
- Rust CLI: `Commands::Dashboards` → `DashboardsSubcommand::Apply(DashboardsApplyArgs{dir, source, dry_run})` in `cli.rs`; dispatched in `main.rs` to `core::run_dashboards_apply`.

---

## File Structure

**New files:**
- `packages/app/src/data/apply/registry.ts` — `kind → reconciler` registry + the `applyResources` orchestrator (group by kind, reconcile every registered kind, aggregate).
- `packages/app/src/data/apply/registry.test.ts` — orchestrator unit tests.
- `packages/app/src/routes/api/apply.ts` — `POST /api/apply`.
- `packages/app/src/routes/api/apply.test.ts` — route test.

**Modified files:**
- `packages/app/src/data/dashboards/schema.ts` — rename `applyDashboardsInput` → `applyInput`.
- `crates/everr-core/src/dashboards.rs` → renamed to `crates/everr-core/src/apply.rs` — generic `ResourceDocument`, `load_resource_documents`, `ApplyRequest`, `ApplySummary` (per-kind), `KindResult`.
- `crates/everr-core/src/lib.rs` — `pub mod apply;` (replacing `pub mod dashboards;`).
- `crates/everr-core/src/api.rs` — `ApiClient::apply` (POST `/api/apply`) returning `ApplySummary`.
- `packages/desktop-app/src-cli/src/cli.rs` — `Commands::Apply(ApplyArgs{dir, source, dry_run})` (remove `Dashboards`).
- `packages/desktop-app/src-cli/src/main.rs` — dispatch `Commands::Apply` → `core::run_apply`.
- `packages/desktop-app/src-cli/src/core.rs` — `run_apply` printing the per-kind summary.
- `docs/superpowers/specs/2026-06-08-gitops-dashboards-design.md` — note the generic `everr apply` + kind registry.

**Deleted files:**
- `packages/app/src/routes/api/dashboards/apply.ts` + `apply.test.ts` (replaced by `/api/apply`).

**Unchanged:** `applyDashboardSpecs` (becomes the Dashboard reconciler), `buildDesiredSet`/`reconcile` (dashboard-specific, used by that reconciler), `requireOrgOrApiKeyMiddleware`, the schema's document shape.

---

## Task 1: Reconciler registry + `applyResources` orchestrator

**Files:**
- Create: `packages/app/src/data/apply/registry.ts`
- Test: `packages/app/src/data/apply/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/data/apply/registry.test.ts
import { describe, expect, it, vi } from "vitest";

const dashboardReconciler = vi.fn();
vi.mock("@/data/dashboards/server", () => ({
  applyDashboardSpecs: (...a: unknown[]) => dashboardReconciler(...a),
}));

import { applyResources } from "./registry";

const doc = (kind: string, name: string) => ({
  path: `${name}.yaml`,
  document: { kind, metadata: { name }, spec: { panels: {}, layouts: [] } },
});

beforeEach(() => {
  vi.clearAllMocks();
  dashboardReconciler.mockResolvedValue({ created: [], updated: [], deleted: [], dryRun: false });
});

import { beforeEach } from "vitest";

describe("applyResources", () => {
  it("routes Dashboard docs to the dashboard reconciler and returns a per-kind summary", async () => {
    dashboardReconciler.mockResolvedValueOnce({
      created: ["cpu"], updated: [], deleted: [], dryRun: false,
    });
    const out = await applyResources({
      orgId: "org-1",
      source: "team",
      documents: [doc("Dashboard", "cpu")],
      dryRun: false,
    });
    expect(dashboardReconciler).toHaveBeenCalledWith({
      orgId: "org-1",
      source: "team",
      documents: [doc("Dashboard", "cpu")],
      dryRun: false,
    });
    expect(out).toEqual({
      dryRun: false,
      results: [{ kind: "Dashboard", created: ["cpu"], updated: [], deleted: [] }],
    });
  });

  it("reconciles every registered kind even when absent from the tree (prunes)", async () => {
    // No Dashboard docs in the tree → the dashboard reconciler still runs with [].
    await applyResources({ orgId: "org-1", source: "team", documents: [], dryRun: false });
    expect(dashboardReconciler).toHaveBeenCalledWith({
      orgId: "org-1",
      source: "team",
      documents: [],
      dryRun: false,
    });
  });

  it("throws on a document missing a string kind", async () => {
    await expect(
      applyResources({
        orgId: "org-1",
        source: "team",
        documents: [{ path: "bad.yaml", document: { metadata: { name: "x" } } }],
        dryRun: false,
      }),
    ).rejects.toThrow(/bad\.yaml.*kind/i);
  });

  it("throws on an unknown kind", async () => {
    await expect(
      applyResources({
        orgId: "org-1",
        source: "team",
        documents: [doc("Gizmo", "x")],
        dryRun: false,
      }),
    ).rejects.toThrow(/unknown kind "Gizmo".*x\.yaml/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/data/apply/registry.test.ts`
Expected: FAIL — `applyResources` missing.

- [ ] **Step 3: Implement the registry + orchestrator**

```typescript
// packages/app/src/data/apply/registry.ts
import { applyDashboardSpecs } from "@/data/dashboards/server";

export interface ApplyDocument {
  path: string;
  document: unknown;
}

export interface KindResult {
  kind: string;
  created: string[];
  updated: string[];
  deleted: string[];
}

export interface ApplyResourcesResult {
  dryRun: boolean;
  results: KindResult[];
}

/** A reconciler makes a source's resources of one kind match the given docs. */
type Reconciler = (opts: {
  orgId: string;
  source: string;
  documents: ApplyDocument[];
  dryRun?: boolean;
}) => Promise<{ created: string[]; updated: string[]; deleted: string[] }>;

/**
 * Resource kind → reconciler. Add a new kind (e.g. "Alert") by adding one entry;
 * the CLI does not change. Every registered kind is reconciled on each apply, so
 * a kind absent from the tree is pruned for the source — the tree is the complete
 * desired state for the source across all kinds.
 */
const REGISTRY: Record<string, Reconciler> = {
  Dashboard: applyDashboardSpecs,
};

function documentKind(doc: ApplyDocument): string {
  const kind = (doc.document as { kind?: unknown } | null)?.kind;
  if (typeof kind !== "string" || kind.length === 0) {
    throw new Error(`${doc.path}: document is missing a string "kind"`);
  }
  return kind;
}

/**
 * Apply a heterogeneous set of resource documents for one source: group by kind,
 * reject unknown kinds, then reconcile EVERY registered kind (groups default to
 * empty so absent kinds prune). Returns a per-kind summary.
 */
export async function applyResources(opts: {
  orgId: string;
  source: string;
  documents: ApplyDocument[];
  dryRun?: boolean;
}): Promise<ApplyResourcesResult> {
  const { orgId, source, documents, dryRun } = opts;

  const byKind = new Map<string, ApplyDocument[]>();
  for (const doc of documents) {
    const kind = documentKind(doc);
    if (!(kind in REGISTRY)) {
      throw new Error(`${doc.path}: unknown kind "${kind}"`);
    }
    byKind.set(kind, [...(byKind.get(kind) ?? []), doc]);
  }

  const results: KindResult[] = [];
  for (const [kind, reconcile] of Object.entries(REGISTRY)) {
    const group = byKind.get(kind) ?? [];
    const r = await reconcile({ orgId, source, documents: group, dryRun });
    results.push({ kind, created: r.created, updated: r.updated, deleted: r.deleted });
  }

  return { dryRun: dryRun ?? false, results };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/app && pnpm exec vitest run src/data/apply/registry.test.ts`
Expected: PASS (4 tests). (Note: the test's `import { beforeEach } from "vitest"` is placed mid-file in the snippet for brevity — move it into the top `import { ... } from "vitest"` line so it's a single import.)

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/data/apply/registry.ts packages/app/src/data/apply/registry.test.ts
git commit -m "feat(apply): kind registry + applyResources orchestrator"
```

---

## Task 2: `POST /api/apply` route; remove `/api/dashboards/apply`

**Files:**
- Modify: `packages/app/src/data/dashboards/schema.ts` (rename input)
- Create: `packages/app/src/routes/api/apply.ts`
- Create: `packages/app/src/routes/api/apply.test.ts`
- Delete: `packages/app/src/routes/api/dashboards/apply.ts`, `packages/app/src/routes/api/dashboards/apply.test.ts`

- [ ] **Step 1: Rename the input schema**

In `schema.ts`, rename `applyDashboardsInput` to `applyInput` (keep the shape: `{ source, documents: applyDocumentSchema[], dryRun? }`) and update `export type ApplyDashboardsInput` → `export type ApplyInput`. Run `rg -n "applyDashboardsInput|ApplyDashboardsInput" packages/app/src` and update all references (currently the old dashboards apply route — being deleted — and any test). `applyDocumentSchema` keeps its name.

- [ ] **Step 2: Write the failing route test**

```typescript
// packages/app/src/routes/api/apply.test.ts
import { describe, expect, it, vi } from "vitest";

const applyResources = vi.fn();
vi.mock("@/data/apply/registry", () => ({
  applyResources: (...a: unknown[]) => applyResources(...a),
}));

import { Route } from "./apply";

const POST = (
  Route.options as unknown as {
    server: { handlers: { POST: (a: { request: Request; context: { session: { session: { activeOrganizationId: string } } } }) => Promise<Response> } };
  }
).server.handlers.POST;

const ctx = { session: { session: { activeOrganizationId: "org-1" } } };
const req = (body: unknown) =>
  new Request("http://x/api/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/apply", () => {
  it("applies and returns the per-kind summary", async () => {
    applyResources.mockResolvedValueOnce({
      dryRun: false,
      results: [{ kind: "Dashboard", created: ["cpu"], updated: [], deleted: [] }],
    });
    const res = await POST({
      request: req({
        source: "team",
        documents: [{ path: "cpu.yaml", document: { kind: "Dashboard", metadata: { name: "cpu" }, spec: { panels: {}, layouts: [] } } }],
      }),
      context: ctx,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      dryRun: false,
      results: [{ kind: "Dashboard", created: ["cpu"], updated: [], deleted: [] }],
    });
    expect(applyResources).toHaveBeenCalledWith({
      orgId: "org-1",
      source: "team",
      documents: [{ path: "cpu.yaml", document: { kind: "Dashboard", metadata: { name: "cpu" }, spec: { panels: {}, layouts: [] } } }],
      dryRun: undefined,
    });
  });

  it("returns 400 on an invalid body", async () => {
    const res = await POST({ request: req({ documents: [] }), context: ctx });
    expect(res.status).toBe(400);
    expect(applyResources).not.toHaveBeenCalled();
  });

  it("returns 400 when applyResources throws (unknown kind / bad doc)", async () => {
    applyResources.mockRejectedValueOnce(new Error('bad.yaml: unknown kind "Gizmo"'));
    const res = await POST({
      request: req({ source: "team", documents: [{ path: "bad.yaml", document: { kind: "Gizmo" } }] }),
      context: ctx,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Gizmo/);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/routes/api/apply.test.ts`
Expected: FAIL — route missing.

- [ ] **Step 4: Implement the route**

```typescript
// packages/app/src/routes/api/apply.ts
import { createFileRoute } from "@tanstack/react-router";
import { applyResources } from "@/data/apply/registry";
import { applyInput } from "@/data/dashboards/schema";
import { requireOrgOrApiKeyMiddleware } from "@/lib/serverFn";

export const Route = createFileRoute("/api/apply")({
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

        const parsed = applyInput.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.issues[0]?.message ?? "Invalid request" },
            { status: 400 },
          );
        }

        try {
          const summary = await applyResources({
            orgId: context.session.session.activeOrganizationId,
            source: parsed.data.source,
            documents: parsed.data.documents,
            dryRun: parsed.data.dryRun,
          });
          return Response.json(summary);
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Failed to apply" },
            { status: 400 },
          );
        }
      },
    },
  },
});
```

- [ ] **Step 5: Delete the old dashboards apply route**

```bash
git rm packages/app/src/routes/api/dashboards/apply.ts packages/app/src/routes/api/dashboards/apply.test.ts
```
If `packages/app/src/routes/api/dashboards/` is now empty, that's fine (leave the empty dir or remove it; git ignores empty dirs).

- [ ] **Step 6: Run tests + typecheck + regenerate routes**

Run: `cd packages/app && pnpm exec vitest run src/data src/routes/api && pnpm exec tsc --noEmit 2>&1 | rg "apply|dashboards" || echo clean`
Expected: PASS; "clean". The committed `routeTree.gen.ts` must drop `/api/dashboards/apply` and add `/api/apply` — if it's hand-maintained, update it (it regenerates on dev/build via the plugin); confirm `rg -n "api/apply|api/dashboards/apply" src/routeTree.gen.ts` shows the new path and not the old.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(apply): POST /api/apply over the kind registry"
```
If fallow flags the removed route's symbols, ensure no stale imports of the old route remain (`rg -n "dashboards/apply" packages/app/src`).

---

## Task 3: Rust — generic resource module + `ApiClient::apply`

**Files:**
- Rename: `crates/everr-core/src/dashboards.rs` → `crates/everr-core/src/apply.rs`
- Modify: `crates/everr-core/src/lib.rs`, `crates/everr-core/src/api.rs`

- [ ] **Step 1: Rename the module and its types**

`git mv crates/everr-core/src/dashboards.rs crates/everr-core/src/apply.rs`. In `apply.rs`, rename:
- `DashboardDocument` → `ResourceDocument` (same fields `path`, `document`).
- `load_dashboard_documents` → `load_resource_documents`.
- `ApplyDashboardsRequest` → `ApplyRequest` (fields `source`, `documents: Vec<ResourceDocument>`, `dry_run`).
- Replace `ApplyDashboardsSummary` with the per-kind shape:

```rust
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct KindResult {
    pub kind: String,
    pub created: Vec<String>,
    pub updated: Vec<String>,
    pub deleted: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ApplySummary {
    #[serde(rename = "dryRun")]
    pub dry_run: bool,
    pub results: Vec<KindResult>,
}
```
Update the in-file tests: rename type/fn references; replace the `ApplyDashboardsSummary` deserialize test with one for `ApplySummary` deserializing `{"dryRun":true,"results":[{"kind":"Dashboard","created":["a"],"updated":[],"deleted":["b"]}]}` and asserting `results[0].kind == "Dashboard"`, `created == ["a"]`, `dry_run == true`. Keep the request-serialization tests (dryRun omitted when false / included when true) using `ApplyRequest`.

- [ ] **Step 2: Update `lib.rs`**

Change `pub mod dashboards;` to `pub mod apply;` (keep alphabetical placement; if other code references `everr_core::dashboards`, it will be updated in api.rs/CLI below).

- [ ] **Step 3: Update `api.rs`**

Rename the method `apply_dashboards` → `apply`, posting to `{base_url}/api/apply`, taking `&crate::apply::ApplyRequest` and returning `crate::apply::ApplySummary`:

```rust
pub async fn apply(
    &self,
    request: &crate::apply::ApplyRequest,
) -> Result<crate::apply::ApplySummary> {
    let response = self
        .http
        .post(format!("{}/api/apply", self.base_url))
        .json(request)
        .send()
        .await
        .context("apply request failed")?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "<failed to read body>".to_string());
        return Err(http_status_error(status, text, "apply"));
    }

    response.json().await.context("failed to decode apply response")
}
```
Keep `from_token` unchanged.

- [ ] **Step 4: Build + test**

Run: `cargo test -p everr-core --lib apply && cargo build -p everr-core`
Expected: builds; tests pass. Run `cargo fmt -p everr-core`. Fix any remaining `dashboards`-name references the compiler flags.

- [ ] **Step 5: Commit**

```bash
git add crates/everr-core/src/apply.rs crates/everr-core/src/lib.rs crates/everr-core/src/api.rs Cargo.lock
git commit -m "refactor(cli): generic resource apply module + ApiClient::apply"
```

---

## Task 4: Rust — `everr apply` command

**Files:**
- Modify: `packages/desktop-app/src-cli/src/cli.rs`, `src/main.rs`, `src/core.rs`

- [ ] **Step 1: Replace the command in `cli.rs`**

Remove `Dashboards(DashboardsArgs)`, `DashboardsArgs`, `DashboardsSubcommand`, `DashboardsApplyArgs`. Add a top-level command:

```rust
    /// Apply a directory of resource definitions (gitops)
    Apply(ApplyArgs),
```
and:
```rust
#[derive(Args, Debug)]
pub struct ApplyArgs {
    /// Directory containing resource YAML/JSON files
    pub dir: String,
    /// Source id that owns these resources (prune scope)
    #[arg(long)]
    pub source: String,
    /// Compute and print the diff without writing
    #[arg(long = "dry-run")]
    pub dry_run: bool,
}
```

- [ ] **Step 2: Dispatch in `main.rs`**

Replace the `Commands::Dashboards(...)` arm with:
```rust
        Commands::Apply(args) => core::run_apply(args).await?,
```

- [ ] **Step 3: Rewrite the handler in `core.rs`**

Rename `run_dashboards_apply` → `run_apply` and update for the generic module + per-kind summary:

```rust
pub async fn run_apply(args: crate::cli::ApplyArgs) -> anyhow::Result<()> {
    use everr_core::apply::{load_resource_documents, ApplyRequest};

    let dir = std::path::Path::new(&args.dir);
    if !dir.is_dir() {
        anyhow::bail!("{} is not a directory", args.dir);
    }
    let documents = load_resource_documents(dir)?;
    if documents.is_empty() {
        eprintln!(
            "warning: no resource files (.yaml/.yml/.json) found under {}",
            args.dir
        );
    }

    let client = match std::env::var("EVERR_API_TOKEN").ok().filter(|t| !t.is_empty()) {
        Some(token) => {
            let base_url = std::env::var("EVERR_API_URL")
                .ok()
                .filter(|u| !u.is_empty())
                .or_else(persisted_api_base_url)
                .ok_or_else(|| {
                    anyhow::anyhow!("EVERR_API_TOKEN is set but no base URL; set EVERR_API_URL")
                })?;
            everr_core::api::ApiClient::from_token(&base_url, &token)?
        }
        None => {
            let session = crate::auth::require_session_with_refresh().await?;
            everr_core::api::ApiClient::from_session(&session)?
        }
    };

    let request = ApplyRequest {
        source: args.source,
        documents,
        dry_run: args.dry_run,
    };
    let summary = client.apply(&request).await?;

    let label = if summary.dry_run { "(dry run) " } else { "" };
    for r in &summary.results {
        println!(
            "{label}{}: {} created, {} updated, {} deleted",
            r.kind,
            r.created.len(),
            r.updated.len(),
            r.deleted.len()
        );
        for s in &r.created {
            println!("  + {s}");
        }
        for s in &r.updated {
            println!("  ~ {s}");
        }
        for s in &r.deleted {
            println!("  - {s}");
        }
    }
    Ok(())
}
```
Keep `persisted_api_base_url` as-is. If the previous code referenced `everr_core::dashboards`, update those references to `everr_core::apply`. Confirm `crate::auth::require_session_with_refresh` is exactly the call used here before (it was).

- [ ] **Step 4: Build + help**

Run: `cargo build -p everr-cli` then `cargo run -p everr-cli -- apply --help` and `cargo run -p everr-cli -- --help`.
Expected: `apply` is a top-level command with `<DIR>`, `--source`, `--dry-run`; `dashboards` is gone. `cargo fmt -p everr-cli`.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop-app/src-cli/src/cli.rs packages/desktop-app/src-cli/src/main.rs packages/desktop-app/src-cli/src/core.rs Cargo.lock
git commit -m "feat(cli): everr apply (generic resource apply)"
```

---

## Task 5: End-to-end smoke + docs

**Files:**
- Modify: `docs/superpowers/specs/2026-06-08-gitops-dashboards-design.md`

- [ ] **Step 1: Smoke the generic command against the dev server**

Reuse the dev server (:5173), the ingest key (org `q6OpBhwEQGGYZbNA6A4zFHinw6yfQlDI`; the `gitops-smoke` key, or mint one), and `docker exec everr-postgres-1 psql -U postgres -d postgres`.

```bash
rm -rf /tmp/dash && mkdir -p /tmp/dash/team
printf 'kind: Dashboard\nmetadata:\n  name: cli-cpu\nspec:\n  panels: {}\n  layouts: []\n' > /tmp/dash/team/cpu.yaml
cargo build -p everr-cli
KEY='ek_...'   # working ingest key
EVERR_API_TOKEN="$KEY" EVERR_API_URL='http://localhost:5173' cargo run -p everr-cli -- apply /tmp/dash --source apply-smoke --dry-run
```
Expected: `(dry run) Dashboard: 1 created` with `+ cli-cpu`; DB row count for source `apply-smoke` = 0.

- [ ] **Step 2: Real apply + delete-by-default + unknown-kind error**

```bash
EVERR_API_TOKEN="$KEY" EVERR_API_URL='http://localhost:5173' cargo run -p everr-cli -- apply /tmp/dash --source apply-smoke
# verify 1 row; then:
rm /tmp/dash/team/cpu.yaml
EVERR_API_TOKEN="$KEY" EVERR_API_URL='http://localhost:5173' cargo run -p everr-cli -- apply /tmp/dash --source apply-smoke
# expect Dashboard: 1 deleted; row gone.
# unknown kind:
printf 'kind: Gizmo\nmetadata:\n  name: g\n' > /tmp/dash/team/g.yaml
EVERR_API_TOKEN="$KEY" EVERR_API_URL='http://localhost:5173' cargo run -p everr-cli -- apply /tmp/dash --source apply-smoke
# expect a non-zero exit with an error mentioning unknown kind "Gizmo" and g.yaml; nothing applied.
```
Expected as annotated. Clean up: `docker exec everr-postgres-1 psql -U postgres -d postgres -c "delete from dashboards where source='apply-smoke';"` and `rm -rf /tmp/dash`.

- [ ] **Step 3: Update the design spec**

In `docs/superpowers/specs/2026-06-08-gitops-dashboards-design.md`, update the CLI/authentication sections (and add a short "Generic apply" note) to reflect: the command is `everr apply <dir> --source=<id> [--dry-run]` (not `everr dashboards apply`); the server dispatches by document `kind` via a registry (`Dashboard` today; add kinds server-side without CLI changes); a source reconciles all registered kinds (complete-tree-per-source; use separate sources to isolate kinds); unknown kinds are rejected.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-08-gitops-dashboards-design.md
git commit -m "docs(gitops): generic everr apply with kind registry"
```

---

## Self-Review Notes (plan vs. locked decisions)

- **`everr apply` top-level:** Task 4 (removes `everr dashboards apply`).
- **Server-side kind registry; CLI stable for future kinds:** Task 1 (`REGISTRY`) + Task 2 (route is a thin transport). Adding `Alert` = one registry entry + reconciler + table; no CLI/route change.
- **A source reconciles all registered kinds (prune absent kinds):** Task 1 orchestrator iterates `REGISTRY`, defaulting empty groups — tested. Documented in Task 5.
- **Unknown kind → hard error:** Task 1 (`unknown kind`) + missing-kind error; surfaced as 400 by the route (Task 2) and non-zero CLI exit (Task 4), smoked in Task 5.
- **Reuses prior work:** `applyDashboardSpecs`/`buildDesiredSet`/`reconcile` unchanged (Dashboard reconciler); `requireOrgOrApiKeyMiddleware`/`from_token` unchanged.
- **Per-kind summary** plumbed end to end: registry → route → `ApplySummary` → CLI output (Tasks 1–4).
- **Deferred:** the actual Alert kind (table + reconciler) — only the seam is built here.
