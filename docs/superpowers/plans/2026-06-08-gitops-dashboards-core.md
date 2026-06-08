# Gitops Dashboards — Core (read-only server + reconcile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dashboards gitops-driven by replacing all in-app editing with a single source-scoped declarative reconcile, and turn the app into a read-only renderer.

**Architecture:** A pure `reconcile` function computes a create/update/delete diff between a source's existing dashboards and a desired set parsed from files. A new `applyDashboards` server function applies that diff transactionally. Identity is `source/slug`; folders are derived from a `folder_path` string. Every mutation server function and editing UI component is removed; the grid, variable bar, and query execution remain.

**Tech Stack:** TypeScript, TanStack Start server functions, TanStack Router, Drizzle (Postgres), Zod, Zustand, Vitest, React.

**Scope note:** This is plan 1 of 3. API tokens (plan 2) and the Rust CLI (plan 3) follow. Here, `applyDashboards` authenticates via the existing user session/org middleware; plan 2 adds token auth.

**Terminology mapping to the spec:** the spec calls a dashboard's per-source identifier its `name`. In the database this is the existing **`slug`** column (a URL-safe identifier), kept to minimize churn. `metadata.name` in the Perses document continues to echo this slug. The human-facing title remains `spec.display.name`. "Identity = source/name" therefore maps to the `(organization_id, source, slug)` tuple.

---

## File Structure

**New files:**
- `packages/app/src/data/dashboards/reconcile.ts` — pure diff: existing vs desired → {creates, updates, deletes}.
- `packages/app/src/data/dashboards/reconcile.test.ts` — diff unit tests.
- `packages/app/src/data/dashboards/desired.ts` — build + validate the desired set from parsed documents (folder path from file path, name resolution, in-source duplicate detection).
- `packages/app/src/data/dashboards/desired.test.ts` — desired-set unit tests.
- `packages/app/src/routes/_authenticated/_dashboard/dashboards/$source.$slug.tsx` — read-only dashboard render route.

**Modified files:**
- `packages/app/src/db/schema/app.ts` — add `source`/`folder_path`, change uniqueness, drop `dashboard_folders` + folder FK + `folder_id`.
- `packages/app/src/data/dashboards/schema.ts` — add apply input schema; drop folder/mutation input schemas.
- `packages/app/src/data/dashboards/server.ts` — add `applyDashboards`; rewrite read fns for source/slug + folder_path; delete mutation fns.
- `packages/app/src/data/dashboards/server.test.ts` — drop mutation tests; add apply/read tests.
- `packages/app/src/data/dashboards/tree.ts` — build tree from `folderPath` strings instead of folder rows.
- `packages/app/src/data/dashboards/tree.test.ts` — update for the new tree input.
- `packages/app/src/data/dashboards/options.ts` — drop mutation hooks + `folderListOptions`; keep read query options.
- `packages/app/src/data/dashboards/dashboard-store.ts` — reduce to a read-only holder.
- `packages/app/src/components/dashboards/dashboard-grid.tsx` — strip editing; render-only.
- `packages/app/src/components/dashboards/dashboard-tree.tsx` — read-only navigation tree.
- `packages/app/src/routes/_authenticated/_dashboard/dashboards/index.tsx` — read-only list (no create buttons).

**Deleted files (editing surfaces):**
- Components: `panel-edit-page.tsx`, `panel-preview.tsx`, `query-editor.tsx`, `query-editor.test.tsx`, `viz-options.tsx`, `settings-general-section.tsx`, `settings-variables-section.tsx`, `settings-json-section.tsx`, `dashboard-settings-page.tsx`, `json-editor.tsx`, `sql-editor.tsx`, `code-editor.tsx`, `folder-picker.tsx`, `name-dialog.tsx`, `delete-dashboard-dialog.tsx`, `delete-folder-dialog.tsx`, `variable-draft.ts`, `variable-draft.test.ts`.
- Routes: `dashboards/new.tsx`, `dashboards/$dashboardId.tsx`, `dashboards/$dashboardId_/settings.tsx`, `dashboards/$dashboardId_/panel/$panelKey.tsx`.

**Kept untouched (read path):** `dashboard-panel.tsx`, `variable-bar.tsx`, `use-dashboard-variables.ts`, `use-panel-queries.ts`, `query-array.ts`, `interpolate.ts`, `variable-values.ts`, `convert.ts`, `time-defaults.ts`, `dashboard-not-found.tsx`, `visualizations/`. (`dashboard-panel.tsx` takes an `isEditing` prop — it will be passed `false`.)

---

## Task 1: Reconcile engine (pure diff)

The heart of the feature. A pure function with no DB or IO, so it gets the heaviest tests.

**Files:**
- Create: `packages/app/src/data/dashboards/reconcile.ts`
- Test: `packages/app/src/data/dashboards/reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/data/dashboards/reconcile.test.ts
import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile";

const spec = (n: number) => ({ panels: {}, layouts: [], _v: n });

describe("reconcile", () => {
  it("creates desired dashboards that don't exist", () => {
    const diff = reconcile({
      existing: [],
      desired: [{ slug: "a", folderPath: "Team", spec: spec(1) }],
    });
    expect(diff.creates).toEqual([
      { slug: "a", folderPath: "Team", spec: spec(1) },
    ]);
    expect(diff.updates).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });

  it("deletes existing dashboards absent from the desired set", () => {
    const diff = reconcile({
      existing: [{ slug: "gone", folderPath: "", spec: spec(1) }],
      desired: [],
    });
    expect(diff.deletes).toEqual(["gone"]);
    expect(diff.creates).toEqual([]);
    expect(diff.updates).toEqual([]);
  });

  it("updates when spec or folderPath changed, skips when identical", () => {
    const diff = reconcile({
      existing: [
        { slug: "same", folderPath: "X", spec: spec(1) },
        { slug: "moved", folderPath: "X", spec: spec(1) },
        { slug: "edited", folderPath: "X", spec: spec(1) },
      ],
      desired: [
        { slug: "same", folderPath: "X", spec: spec(1) },
        { slug: "moved", folderPath: "Y", spec: spec(1) },
        { slug: "edited", folderPath: "X", spec: spec(2) },
      ],
    });
    expect(diff.updates.map((u) => u.slug).sort()).toEqual(["edited", "moved"]);
    expect(diff.creates).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/reconcile.test.ts`
Expected: FAIL — `reconcile` is not exported / file missing.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/app/src/data/dashboards/reconcile.ts
import type { DashboardSpec } from "./schema";

/** A dashboard as it exists in the store, scoped to a single source. */
export interface ExistingDashboard {
  slug: string;
  folderPath: string;
  spec: DashboardSpec;
}

/** A dashboard declared in the desired set (parsed from a file). */
export interface DesiredDashboard {
  slug: string;
  folderPath: string;
  spec: DashboardSpec;
}

export interface ReconcileDiff {
  creates: DesiredDashboard[];
  updates: DesiredDashboard[];
  deletes: string[];
}

/**
 * Compute the create/update/delete diff to make a single source's dashboards
 * match the desired set. `existing` MUST already be scoped to the applying
 * source — this function never reasons about other sources, which is what makes
 * delete-by-default safe across multiple repos.
 *
 * A dashboard is "changed" when its folderPath or its spec differs. Specs are
 * compared by stable-stringify so unknown Perses fields participate in the
 * comparison and are preserved verbatim (the desired spec is stored as-is).
 */
export function reconcile(input: {
  existing: ExistingDashboard[];
  desired: DesiredDashboard[];
}): ReconcileDiff {
  const existingBySlug = new Map(input.existing.map((d) => [d.slug, d]));
  const desiredSlugs = new Set(input.desired.map((d) => d.slug));

  const creates: DesiredDashboard[] = [];
  const updates: DesiredDashboard[] = [];
  for (const want of input.desired) {
    const have = existingBySlug.get(want.slug);
    if (!have) {
      creates.push(want);
    } else if (
      have.folderPath !== want.folderPath ||
      stableStringify(have.spec) !== stableStringify(want.spec)
    ) {
      updates.push(want);
    }
  }

  const deletes = input.existing
    .filter((d) => !desiredSlugs.has(d.slug))
    .map((d) => d.slug);

  return { creates, updates, deletes };
}

/** Deterministic JSON with object keys sorted recursively. */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/reconcile.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add a key-order-insensitive comparison test**

```typescript
// append inside the describe block in reconcile.test.ts
it("does not update when only key order differs", () => {
  const diff = reconcile({
    existing: [{ slug: "a", folderPath: "", spec: { panels: {}, layouts: [], x: 1, y: 2 } }],
    desired: [{ slug: "a", folderPath: "", spec: { panels: {}, layouts: [], y: 2, x: 1 } }],
  });
  expect(diff.updates).toEqual([]);
});
```

- [ ] **Step 6: Run and confirm pass**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/reconcile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/data/dashboards/reconcile.ts packages/app/src/data/dashboards/reconcile.test.ts
git commit -m "feat(dashboards): pure source-scoped reconcile diff"
```

---

## Task 2: Desired-set builder (parse + validate documents)

Turns an array of `{ path, document }` (raw parsed YAML/JSON from the CLI) into a validated, deduplicated desired set, deriving `folderPath` from the directory and `slug` from `metadata.name` (falling back to the filename).

**Files:**
- Create: `packages/app/src/data/dashboards/desired.ts`
- Test: `packages/app/src/data/dashboards/desired.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/data/dashboards/desired.test.ts
import { describe, expect, it } from "vitest";
import { buildDesiredSet } from "./desired";

const doc = (name?: string) => ({
  kind: "Dashboard",
  ...(name ? { metadata: { name } } : {}),
  spec: { panels: {}, layouts: [] },
});

describe("buildDesiredSet", () => {
  it("derives folderPath from directories and slug from metadata.name", () => {
    const set = buildDesiredSet([
      { path: "platform/latency/overview.yaml", document: doc("latency-overview") },
    ]);
    expect(set).toEqual([
      {
        slug: "latency-overview",
        folderPath: "platform / latency",
        spec: { panels: {}, layouts: [] },
      },
    ]);
  });

  it("falls back to the filename (sans extension) when metadata.name is absent", () => {
    const set = buildDesiredSet([{ path: "overview.json", document: doc() }]);
    expect(set[0]?.slug).toBe("overview");
    expect(set[0]?.folderPath).toBe("");
  });

  it("throws on a duplicate slug within the source", () => {
    expect(() =>
      buildDesiredSet([
        { path: "a/x.yaml", document: doc("dup") },
        { path: "b/y.yaml", document: doc("dup") },
      ]),
    ).toThrow(/duplicate dashboard "dup"/i);
  });

  it("throws with the file path when a document fails schema validation", () => {
    expect(() =>
      buildDesiredSet([{ path: "bad.yaml", document: { kind: "Dashboard", spec: {} } }]),
    ).toThrow(/bad\.yaml/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/desired.test.ts`
Expected: FAIL — `buildDesiredSet` missing.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/app/src/data/dashboards/desired.ts
import { dashboardSpecSchema, dashboardSlugSchema } from "./schema";
import type { DesiredDashboard } from "./reconcile";

export interface InputDocument {
  /** POSIX-style path relative to the applied root, e.g. "team/cpu.yaml". */
  path: string;
  /** Raw parsed YAML/JSON document. */
  document: unknown;
}

/** Titleize a single path segment: "latency_p99" → "latency p99". */
function segmentLabel(segment: string): string {
  return segment.replace(/[_-]+/g, " ").trim();
}

/** Folder path from a file path: directory segments joined by " / ". */
function folderPathFromFile(path: string): string {
  const segments = path.split("/").slice(0, -1).map(segmentLabel).filter(Boolean);
  return segments.join(" / ");
}

/** Slug from metadata.name, falling back to the filename without extension. */
function slugFromDocument(path: string, document: unknown): string {
  const meta = (document as { metadata?: { name?: unknown } }).metadata;
  if (meta && typeof meta.name === "string" && meta.name.length > 0) {
    return meta.name;
  }
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.(ya?ml|json)$/i, "");
}

/**
 * Validate and normalize parsed documents into a desired set for `reconcile`.
 * Throws on schema failure (message names the file) or a duplicate slug within
 * the source.
 */
export function buildDesiredSet(inputs: InputDocument[]): DesiredDashboard[] {
  const out: DesiredDashboard[] = [];
  const seen = new Map<string, string>(); // slug -> first path

  for (const { path, document } of inputs) {
    const slug = slugFromDocument(path, document);

    const slugResult = dashboardSlugSchema.safeParse(slug);
    if (!slugResult.success) {
      throw new Error(
        `${path}: invalid dashboard name "${slug}": ${slugResult.error.issues[0]?.message}`,
      );
    }

    const rawSpec = (document as { spec?: unknown }).spec;
    const specResult = dashboardSpecSchema.safeParse(rawSpec);
    if (!specResult.success) {
      throw new Error(
        `${path}: invalid dashboard spec: ${specResult.error.issues[0]?.message}`,
      );
    }

    const prior = seen.get(slug);
    if (prior) {
      throw new Error(
        `duplicate dashboard "${slug}" in source (${prior} and ${path})`,
      );
    }
    seen.set(slug, path);

    // Store the raw spec, not the parsed result, so unknown Perses fields
    // survive verbatim (the file is the source of truth).
    out.push({
      slug,
      folderPath: folderPathFromFile(path),
      spec: rawSpec as DesiredDashboard["spec"],
    });
  }

  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/desired.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/data/dashboards/desired.ts packages/app/src/data/dashboards/desired.test.ts
git commit -m "feat(dashboards): build validated desired set from documents"
```

---

## Task 3: Schema changes (add source/folder_path, drop folder objects)

**Files:**
- Modify: `packages/app/src/db/schema/app.ts:175-241`

Per `CLAUDE.md`, do NOT run Drizzle migration generation — edit the schema only.

- [ ] **Step 1: Remove the `dashboardFolders` table**

Delete the entire `export const dashboardFolders = pgTable("dashboard_folders", { ... });` block (`app.ts:175-206`).

- [ ] **Step 2: Replace the `dashboards` table definition**

Replace the `export const dashboards = pgTable(...)` block (`app.ts:208-241`) with:

```typescript
export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    // The gitops source that owns this dashboard (prune/reconcile scope).
    source: text("source").notNull(),
    // URL-safe per-source identifier (the spec's "name"); also echoed as
    // metadata.name in the stored document.
    slug: text("slug").notNull(),
    // Derived display path ("Team / Latency"); empty string = root.
    folderPath: text("folder_path").notNull().default(""),
    spec: jsonb("spec").notNull().$type<DashboardSpec>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Identity is (org, source, slug): same-named dashboards from different
    // sources coexist; an in-source duplicate is rejected.
    uniqueIndex("dashboards_tenant_source_slug_uq").on(
      table.organizationId,
      table.source,
      table.slug,
    ),
    index("dashboards_tenant_updated_idx").on(
      table.organizationId,
      sql`updated_at DESC`,
    ),
  ],
);
```

- [ ] **Step 3: Remove now-unused imports**

In `app.ts`, remove `foreignKey` and `unique` from the `drizzle-orm/pg-core` import **only if** no other table in the file still uses them. Run: `cd packages/app && rg -n "foreignKey|[^.]\bunique\(" src/db/schema/app.ts` and keep whichever are still referenced.

- [ ] **Step 4: Reset the local dev database to apply the schema**

Run: `everr-dev reset-db` (fall back to `everr reset-db`), or use the `reset-db` skill. This rebuilds dev Postgres from the current schema without generating a migration.
Expected: command completes; `dashboards` has `source`/`folder_path`, `dashboard_folders` is gone.

- [ ] **Step 5: Typecheck the schema change surface**

Run: `cd packages/app && pnpm exec tsc --noEmit`
Expected: errors ONLY in files this plan rewrites later (server.ts, options.ts, tree.ts, components, routes). Note them; they are addressed in Tasks 4–9.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/db/schema/app.ts
git commit -m "feat(dashboards): source-scoped schema, drop folder objects"
```

---

## Task 4: Apply input schema; drop folder/mutation input schemas

**Files:**
- Modify: `packages/app/src/data/dashboards/schema.ts:195-244`

- [ ] **Step 1: Delete the mutation/folder input schemas**

Remove these exports from `schema.ts`: `saveDashboardInput`, `createDashboardInput`, `deleteDashboardInput`, `createFolderInput`, `renameFolderInput`, `deleteFolderInput`, `renameDashboardInput`, `moveDashboardInput`, `moveFolderInput` (`schema.ts:198-243`). Keep `dashboardSlugSchema`, `dashboardModelSchema`, `dashboardModelJsonSchema`, and all type exports.

- [ ] **Step 2: Add the apply input schema**

Append to `schema.ts`:

```typescript
/** A single document in an apply request: its relative path and raw contents. */
export const applyDocumentSchema = z.object({
  path: z.string().min(1),
  // Raw parsed YAML/JSON; validated per-document by buildDesiredSet.
  document: z.unknown(),
});

export const applyDashboardsInput = z.object({
  source: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      "Source must use lowercase letters, digits and hyphens",
    ),
  documents: z.array(applyDocumentSchema),
  /** When true, compute and return the diff without writing. */
  dryRun: z.boolean().optional(),
});

export type ApplyDashboardsInput = z.infer<typeof applyDashboardsInput>;
```

- [ ] **Step 3: Typecheck this file in isolation**

Run: `cd packages/app && pnpm exec tsc --noEmit 2>&1 | rg "data/dashboards/schema.ts"`
Expected: no errors originating in `schema.ts` itself.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/data/dashboards/schema.ts
git commit -m "feat(dashboards): apply input schema, remove edit input schemas"
```

---

## Task 5: `applyDashboards` server function (transactional)

Loads the source's existing dashboards, builds the desired set, computes the diff, and applies it in one transaction. Returns a summary (also used for `dryRun`).

**Files:**
- Modify: `packages/app/src/data/dashboards/server.ts`
- Test: `packages/app/src/data/dashboards/server.test.ts`

- [ ] **Step 1: Write the failing test (dry run returns a diff, writes nothing)**

Add to `server.test.ts`. The existing mock builder (top of file) must expose a `transaction` and a `delete` chain — extend the `vi.mock("@/db/client", …)` factory so `db.transaction(fn)` calls `fn(tx)` with a tx exposing `insert`/`update`/`delete` chains, and add a `deleteChain` `{ where: vi.fn(() => deleteImpl()) }` alongside the existing chains. Then:

```typescript
import { applyDashboards } from "./server";

describe("applyDashboards", () => {
  it("dryRun computes a diff and does not write", async () => {
    // Source currently has one dashboard "old"; desired declares "new" only.
    selectImpl = () => [{ slug: "old", folderPath: "", spec: { panels: {}, layouts: [] } }];
    const result = await applyDashboards({
      data: {
        source: "team",
        dryRun: true,
        documents: [
          {
            path: "new.yaml",
            document: { kind: "Dashboard", metadata: { name: "new" }, spec: { panels: {}, layouts: [] } },
          },
        ],
      },
    });
    expect(result).toEqual({
      created: ["new"],
      updated: [],
      deleted: ["old"],
      dryRun: true,
    });
    expect(mockedDb.transaction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts -t applyDashboards`
Expected: FAIL — `applyDashboards` missing.

- [ ] **Step 3: Implement `applyDashboards` and delete the mutation fns**

In `server.ts`: delete `createDashboard`, `saveDashboard`, `deleteDashboard`, `renameDashboard`, `moveDashboard`, `createFolder`, `renameFolder`, `moveFolder`, `deleteFolder`, `listFolders`, `assertFolderInOrg`, `generateDashboardSlug`, the slug-collision helpers (`generateDashboardSlug`, `MAX_ATTEMPTS` loop), and the `dashboardFolders` import. Keep `getDashboard`, `listDashboards`, `runPanelQuery`, `runVariableOptionsQuery` (rewritten in Task 6). Add:

```typescript
import { buildDesiredSet } from "./desired";
import { reconcile } from "./reconcile";
import { applyDashboardsInput } from "./schema";

export const applyDashboards = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(applyDashboardsInput)
  .handler(async ({ data: { source, documents, dryRun }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    // Validate + normalize the desired set (throws with file path on failure).
    const desired = buildDesiredSet(documents);

    // Load ONLY this source's dashboards — the diff never sees other sources,
    // which is what makes delete-by-default safe across repos.
    const existing = await db
      .select({
        slug: dashboards.slug,
        folderPath: dashboards.folderPath,
        spec: dashboards.spec,
      })
      .from(dashboards)
      .where(
        and(
          eq(dashboards.organizationId, orgId),
          eq(dashboards.source, source),
        ),
      );

    const diff = reconcile({ existing, desired });

    const summary = {
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
  });
```

- [ ] **Step 4: Run the dryRun test**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts -t applyDashboards`
Expected: PASS.

- [ ] **Step 5: Add a write-path test (non-dryRun runs a transaction)**

```typescript
// inside describe("applyDashboards", …)
it("applies the diff inside a transaction when not a dry run", async () => {
  selectImpl = () => [];
  const result = await applyDashboards({
    data: {
      source: "team",
      documents: [
        {
          path: "a.yaml",
          document: { kind: "Dashboard", metadata: { name: "a" }, spec: { panels: {}, layouts: [] } },
        },
      ],
    },
  });
  expect(result.created).toEqual(["a"]);
  expect(result.dryRun).toBe(false);
  expect(mockedDb.transaction).toHaveBeenCalledOnce();
});
```

- [ ] **Step 6: Add a validation-error test (bad doc rejects the whole apply)**

```typescript
it("rejects the apply when a document is invalid", async () => {
  selectImpl = () => [];
  await expect(
    applyDashboards({
      data: {
        source: "team",
        documents: [{ path: "bad.yaml", document: { kind: "Dashboard", spec: {} } }],
      },
    }),
  ).rejects.toThrow(/bad\.yaml/);
  expect(mockedDb.transaction).not.toHaveBeenCalled();
});
```

- [ ] **Step 7: Run the whole dashboards data suite; delete obsolete mutation tests**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts`
Remove every test referencing a deleted fn (`saveDashboard`, `createDashboard`, `renameDashboard`, `moveFolder`, `createFolder`, `renameFolder`, the `generateDashboardSlug` test, etc.) and drop those names from the import at `server.test.ts:56-67`. Re-run until green.
Expected: PASS — only apply + read tests remain.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/data/dashboards/server.ts packages/app/src/data/dashboards/server.test.ts
git commit -m "feat(dashboards): transactional applyDashboards, remove mutation fns"
```

---

## Task 6: Read path — getDashboard/listDashboards by source/slug + folder_path

**Files:**
- Modify: `packages/app/src/data/dashboards/server.ts` (read fns)
- Modify: `packages/app/src/data/dashboards/server.test.ts`

- [ ] **Step 1: Write failing tests for the new read shapes**

```typescript
// in server.test.ts
describe("getDashboard (source/slug)", () => {
  it("looks up by org + source + slug and returns the Perses document", async () => {
    selectImpl = () => [{ slug: "cpu", spec: { panels: {}, layouts: [] } }];
    const result = await getDashboard({ data: { source: "team", slug: "cpu" } });
    expect(result).toEqual({
      kind: "Dashboard",
      metadata: { name: "cpu" },
      spec: { panels: {}, layouts: [] },
    });
  });

  it("throws when not found", async () => {
    selectImpl = () => [];
    await expect(
      getDashboard({ data: { source: "team", slug: "missing" } }),
    ).rejects.toThrow(/not found/);
  });
});

describe("listDashboards (with source + folderPath)", () => {
  it("returns slug, source, name and folderPath", async () => {
    selectImpl = () => [
      { slug: "cpu", source: "team", folderPath: "Infra", displayName: "CPU" },
    ];
    const rows = await listDashboards();
    expect(rows).toEqual([
      { slug: "cpu", source: "team", name: "CPU", folderPath: "Infra" },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts -t "source/slug"`
Expected: FAIL — `getDashboard` still takes `{ dashboardId }`.

- [ ] **Step 3: Rewrite `getDashboard`**

Replace the `getDashboard` definition in `server.ts` with:

```typescript
export const getDashboard = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ source: z.string(), slug: z.string() }))
  .handler(async ({ data: { source, slug }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    const [row] = await db
      .select({ slug: dashboards.slug, spec: dashboards.spec })
      .from(dashboards)
      .where(
        and(
          eq(dashboards.organizationId, orgId),
          eq(dashboards.source, source),
          eq(dashboards.slug, slug),
        ),
      )
      .limit(1);

    if (!row) {
      throw new Error(`Dashboard "${source}/${slug}" not found`);
    }

    // Validate shape; return the raw stored spec so unknown Perses fields
    // survive read.
    dashboardSpecSchema.parse(row.spec);

    return {
      kind: "Dashboard",
      metadata: { name: row.slug },
      spec: row.spec,
    } satisfies Dashboard;
  });
```

- [ ] **Step 4: Rewrite `listDashboards`**

Replace `listDashboards` in `server.ts` with:

```typescript
export const listDashboards = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context }) => {
  const orgId = context.session.session.activeOrganizationId;

  const rows = await db
    .select({
      slug: dashboards.slug,
      source: dashboards.source,
      folderPath: dashboards.folderPath,
      displayName: sql<string>`spec->'display'->>'name'`,
    })
    .from(dashboards)
    .where(eq(dashboards.organizationId, orgId));

  return rows.map((r) => ({
    slug: r.slug,
    source: r.source,
    name: r.displayName ?? r.slug,
    folderPath: r.folderPath,
  }));
});
```

- [ ] **Step 5: Update the db mock to include the new columns**

In `server.test.ts`, extend the `vi.mock("@/db/schema", …)` `dashboards` object with `source: "source"` and `folderPath: "folder_path"`, and remove the entire `dashboardFolders` mock object.

- [ ] **Step 6: Run the read tests**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/data/dashboards/server.ts packages/app/src/data/dashboards/server.test.ts
git commit -m "feat(dashboards): read dashboards by source/slug with folder_path"
```

---

## Task 7: Tree from folder paths

Rebuild the browse tree from `folderPath` strings instead of folder rows.

**Files:**
- Modify: `packages/app/src/data/dashboards/tree.ts`
- Modify: `packages/app/src/data/dashboards/tree.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tree.test.ts — replace the file's contents
import { describe, expect, it } from "vitest";
import { buildTree, type DashboardSummary } from "./tree";

const d = (slug: string, source: string, name: string, folderPath: string): DashboardSummary =>
  ({ slug, source, name, folderPath });

describe("buildTree (folder paths)", () => {
  it("nests dashboards by their folderPath segments", () => {
    const tree = buildTree([
      d("cpu", "team", "CPU", "Infra / Compute"),
      d("root", "team", "Root", ""),
    ]);
    expect(tree.dashboards.map((x) => x.slug)).toEqual(["root"]);
    expect(tree.folders[0]?.name).toBe("Infra");
    expect(tree.folders[0]?.subfolders[0]?.name).toBe("Compute");
    expect(tree.folders[0]?.subfolders[0]?.dashboards[0]?.slug).toBe("cpu");
  });

  it("merges dashboards from different sources into the same folder", () => {
    const tree = buildTree([
      d("a", "x", "A", "Shared"),
      d("b", "y", "B", "Shared"),
    ]);
    expect(tree.folders).toHaveLength(1);
    expect(tree.folders[0]?.dashboards.map((x) => x.slug).sort()).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/tree.test.ts`
Expected: FAIL — `buildTree` signature mismatch.

- [ ] **Step 3: Rewrite `tree.ts`**

```typescript
// tree.ts — full replacement
export interface DashboardSummary {
  slug: string;
  source: string;
  name: string;
  folderPath: string;
}

export interface FolderNode {
  name: string;
  path: string;
  subfolders: FolderNode[];
  dashboards: DashboardSummary[];
}

export interface DashboardTree {
  folders: FolderNode[];
  dashboards: DashboardSummary[];
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);

const dashboardOrder = (a: DashboardSummary, b: DashboardSummary) =>
  byName(a, b) || a.slug.localeCompare(b.slug) || a.source.localeCompare(b.source);

function splitPath(folderPath: string): string[] {
  return folderPath
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

interface MutableNode {
  name: string;
  path: string;
  children: Map<string, MutableNode>;
  dashboards: DashboardSummary[];
}

function emptyNode(name: string, path: string): MutableNode {
  return { name, path, children: new Map(), dashboards: [] };
}

export function buildTree(dashboards: DashboardSummary[]): DashboardTree {
  const root = emptyNode("", "");

  for (const dashboard of dashboards) {
    const segments = splitPath(dashboard.folderPath);
    let node = root;
    const acc: string[] = [];
    for (const segment of segments) {
      acc.push(segment);
      const path = acc.join(" / ");
      let child = node.children.get(segment);
      if (!child) {
        child = emptyNode(segment, path);
        node.children.set(segment, child);
      }
      node = child;
    }
    node.dashboards.push(dashboard);
  }

  const freeze = (node: MutableNode): FolderNode => ({
    name: node.name,
    path: node.path,
    subfolders: [...node.children.values()]
      .map(freeze)
      .sort((a, b) => a.name.localeCompare(b.name)),
    dashboards: [...node.dashboards].sort(dashboardOrder),
  });

  return {
    folders: [...root.children.values()]
      .map(freeze)
      .sort((a, b) => a.name.localeCompare(b.name)),
    dashboards: [...root.dashboards].sort(dashboardOrder),
  };
}

export interface SearchResults {
  dashboards: { dashboard: DashboardSummary; path: string }[];
}

export function searchItems(
  dashboards: DashboardSummary[],
  query: string,
): SearchResults {
  const q = query.trim().toLowerCase();
  if (!q) return { dashboards: [] };
  return {
    dashboards: dashboards
      .filter((d) => d.name.toLowerCase().includes(q))
      .sort(dashboardOrder)
      .map((dashboard) => ({ dashboard, path: dashboard.folderPath })),
  };
}
```

- [ ] **Step 4: Run the tree tests**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/tree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/data/dashboards/tree.ts packages/app/src/data/dashboards/tree.test.ts
git commit -m "feat(dashboards): build browse tree from folder paths"
```

---

## Task 8: Options + store — read-only

**Files:**
- Modify: `packages/app/src/data/dashboards/options.ts`
- Modify: `packages/app/src/data/dashboards/dashboard-store.ts`

- [ ] **Step 1: Rewrite `options.ts` to read-only query options**

Replace the whole file with (drops every `useMutation` hook, `folderListOptions`, and the mutation server-fn imports):

```typescript
// options.ts
import { queryOptions } from "@tanstack/react-query";
import type { VariableMeta, VariableValues } from "./interpolate";
import {
  getDashboard,
  listDashboards,
  runPanelQuery,
  runVariableOptionsQuery,
} from "./server";

const dashboardsQueryKey = ["dashboards"] as const;

export const dashboardOptions = (source: string, slug: string) =>
  queryOptions({
    queryKey: [...dashboardsQueryKey, source, slug],
    queryFn: () => getDashboard({ data: { source, slug } }),
  });

export const dashboardListOptions = () =>
  queryOptions({
    queryKey: [...dashboardsQueryKey, "list"],
    queryFn: () => listDashboards(),
  });

export const panelQueryOptions = (
  sql: string,
  from?: string,
  to?: string,
  variables?: VariableValues,
  variableMeta?: VariableMeta,
) =>
  queryOptions({
    queryKey: ["panel-query", sql, from, to, variables ?? null, variableMeta ?? null],
    queryFn: () => runPanelQuery({ data: { sql, from, to, variables, variableMeta } }),
    enabled: sql.trim().length > 0,
  });

export const variableOptionsQueryOptions = (query: string, from?: string, to?: string) =>
  queryOptions({
    queryKey: ["variable-options", query, from, to],
    queryFn: () => runVariableOptionsQuery({ data: { query, from, to } }),
    enabled: query.trim().length > 0,
  });
```

- [ ] **Step 2: Reduce the store to a read-only holder**

Replace `dashboard-store.ts` with:

```typescript
// dashboard-store.ts
import { create } from "zustand";
import type { Dashboard } from "./schema";

interface DashboardState {
  dashboard: Dashboard | null;
  /** Identity the dashboard was loaded from, "source/slug"; null = none. */
  loadedKey: string | null;
  setDashboard: (d: Dashboard, key: string) => void;
  reset: () => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  dashboard: null,
  loadedKey: null,
  setDashboard: (dashboard, key) => set({ dashboard, loadedKey: key }),
  reset: () => set({ dashboard: null, loadedKey: null }),
}));
```

- [ ] **Step 3: Update/trim the store test**

Open `packages/app/src/data/dashboards/dashboard-store.test.ts`; remove tests for `isDirty`, `isEditing`, `patchDashboard`, `updatePanel`, `updateLayout`, `updateVariables`, `markSaved`, `updateDisplayName`, `setEditing`. Keep/adjust `setDashboard`/`reset` to the new signature (`setDashboard(d, "team/cpu")` sets `loadedKey`).

- [ ] **Step 4: Run both tests**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/dashboard-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/data/dashboards/options.ts packages/app/src/data/dashboards/dashboard-store.ts packages/app/src/data/dashboards/dashboard-store.test.ts
git commit -m "refactor(dashboards): read-only options and store"
```

---

## Task 9: Delete editing components and routes

Pure deletion — no code, just removals. Each sub-step deletes a cohesive group, then the next task fixes the remaining consumers (`dashboard-grid`, `dashboard-tree`, `index`).

**Files:** see "Deleted files" in the File Structure section.

- [ ] **Step 1: Delete the edit routes**

```bash
git rm packages/app/src/routes/_authenticated/_dashboard/dashboards/new.tsx \
       packages/app/src/routes/_authenticated/_dashboard/dashboards/'$dashboardId'.tsx
git rm -r packages/app/src/routes/_authenticated/_dashboard/dashboards/'$dashboardId_'
```

- [ ] **Step 2: Delete the editing components**

```bash
cd packages/app/src/components/dashboards
git rm panel-edit-page.tsx panel-preview.tsx query-editor.tsx query-editor.test.tsx \
       viz-options.tsx settings-general-section.tsx settings-variables-section.tsx \
       settings-json-section.tsx dashboard-settings-page.tsx json-editor.tsx \
       sql-editor.tsx code-editor.tsx folder-picker.tsx name-dialog.tsx \
       delete-dashboard-dialog.tsx delete-folder-dialog.tsx
```

- [ ] **Step 3: Delete variable-draft**

```bash
git rm packages/app/src/data/dashboards/variable-draft.ts \
       packages/app/src/data/dashboards/variable-draft.test.ts
```

- [ ] **Step 4: Commit the deletions**

```bash
git commit -m "feat(dashboards): remove click-based editing surfaces"
```

(Typecheck/build will fail until Task 10 — that's expected; deletions and their consumer fixes are committed back-to-back.)

---

## Task 10: Read-only render route, grid, tree, and list

Wire the surviving UI to the new identity and remove edit affordances.

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/dashboards/$source.$slug.tsx`
- Modify: `packages/app/src/components/dashboards/dashboard-grid.tsx`
- Modify: `packages/app/src/components/dashboards/dashboard-tree.tsx`
- Modify: `packages/app/src/routes/_authenticated/_dashboard/dashboards/index.tsx`

- [ ] **Step 1: Create the read-only render route**

```tsx
// $source.$slug.tsx
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  notFound,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import { DashboardNotFound } from "@/components/dashboards/dashboard-not-found";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import { dashboardOptions } from "@/data/dashboards/options";
import { dashboardSearchDefaults } from "@/data/dashboards/time-defaults";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboards/$source/$slug",
)({
  staticData: {
    breadcrumb: (match: { loaderData?: { name: string } }) => [
      { label: "Dashboards", to: "/dashboards" },
      { label: match.loaderData?.name ?? "Dashboard" },
    ],
  },
  head: () => ({ meta: [{ title: "Everr - Dashboard" }] }),
  component: DashboardPage,
  notFoundComponent: DashboardNotFound,
  loader: async ({ context: { queryClient }, params: { source, slug } }) => {
    try {
      const dashboard = await queryClient.ensureQueryData(
        dashboardOptions(source, slug),
      );
      return { name: dashboard.spec.display?.name ?? slug };
    } catch {
      throw notFound();
    }
  },
});

function DashboardPage() {
  const { source, slug } = Route.useParams();
  const key = `${source}/${slug}`;
  const { data } = useSuspenseQuery(dashboardOptions(source, slug));
  const setDashboard = useDashboardStore((s) => s.setDashboard);
  const dashboard = useDashboardStore((s) => s.dashboard);
  const loadedKey = useDashboardStore((s) => s.loadedKey);

  useEffect(() => {
    if (!dashboard || loadedKey !== key) setDashboard(data, key);
  }, [data, dashboard, loadedKey, key, setDashboard]);

  const search = useSearch({ from: "/_authenticated/_dashboard" });
  const navigate = useNavigate();
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (seededFor.current === key) return;
    seededFor.current = key;
    const patch = dashboardSearchDefaults(data.spec, search);
    if (patch) {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }),
        replace: true,
      });
    }
  }, [key, data, search, navigate]);

  if (!dashboard) return null;
  return <DashboardGrid />;
}
```

- [ ] **Step 2: Rewrite `dashboard-grid.tsx` as render-only**

Replace the whole file with:

```tsx
// dashboard-grid.tsx
import { useMemo } from "react";
import type { LayoutItem } from "react-grid-layout";
import { GridLayout, useContainerWidth, verticalCompactor } from "react-grid-layout";
import { persesToRGL } from "@/data/dashboards/convert";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import { DashboardPanel } from "./dashboard-panel";
import { VariableBar } from "./variable-bar";

const GRID_COLS = 24;
const ROW_HEIGHT = 30;

export function DashboardGrid() {
  const dashboard = useDashboardStore((s) => s.dashboard);
  const { width, containerRef } = useContainerWidth({ measureBeforeMount: true });

  const layout = useMemo(() => {
    if (!dashboard) return [];
    const firstLayout = dashboard.spec.layouts[0];
    if (!firstLayout) return [];
    return persesToRGL(firstLayout.spec.items);
  }, [dashboard]);

  if (!dashboard) return null;

  return (
    <div>
      <VariableBar />
      <div ref={containerRef}>
        <GridLayout
          width={width}
          className="layout"
          layout={layout}
          gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT }}
          dragConfig={{ enabled: false }}
          resizeConfig={{ enabled: false }}
          compactor={verticalCompactor}
          autoSize
        >
          {layout.map((item: LayoutItem) => {
            const panel = dashboard.spec.panels[item.i];
            if (!panel) return null;
            return (
              <div key={item.i}>
                <DashboardPanel panel={panel} panelKey={item.i} isEditing={false} />
              </div>
            );
          })}
        </GridLayout>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Check `DashboardPanel`'s required props**

Run: `cd packages/app && rg -n "interface DashboardPanelProps|dashboardId|onRemove|onDuplicate" src/components/dashboards/dashboard-panel.tsx`
If `dashboardId`, `onRemove`, or `onDuplicate` are **required**, make them optional in `dashboard-panel.tsx` and guard their (edit-only) usages behind `isEditing`. Remove any edit-only menu items that depended on them. Keep the panel's view affordances (e.g. links to query results) intact.

- [ ] **Step 4: Rewrite `dashboard-tree.tsx` as read-only navigation**

Replace its data dependencies: it now takes `dashboards: DashboardSummary[]` and `search: string` only (no `folders`, no `onCreateSubfolder`), calls `buildTree(dashboards)` / `searchItems(dashboards, search)`, and renders folder nodes + dashboard links to `"/dashboards/$source/$slug"` with `params={{ source: d.source, slug: d.slug }}`. Remove all imports of `useCreateFolder`, `useRenameFolder`, `useMoveFolder`, `useDeleteFolder`, `useRenameDashboard`, `useMoveDashboard`, `useDeleteDashboard`, `folder-picker`, `name-dialog`, `delete-*-dialog`, and every right-click/menu edit affordance. Folder nodes are non-interactive grouping headers keyed by `node.path`.

- [ ] **Step 5: Rewrite `index.tsx` as a read-only list**

Replace `dashboards/index.tsx` with a version that:
- Drops `folderListOptions`, `useCreateFolder`, `NameDialog`, the "New Folder" / "New Dashboard" buttons, and the create-folder dialog/state.
- Loads only `dashboardListOptions()`.
- Renders `<DashboardTree dashboards={dashboards ?? []} search={search} />`.
- Keeps the search input, loading state, and error state.
- Empty state: a message ("No dashboards yet — apply some with the everr CLI") with no create button.

```tsx
// index.tsx
import { Input } from "@everr/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, LayoutDashboard, SearchIcon } from "lucide-react";
import { useState } from "react";
import { DashboardTree } from "@/components/dashboards/dashboard-tree";
import { dashboardListOptions } from "@/data/dashboards/options";

export const Route = createFileRoute("/_authenticated/_dashboard/dashboards/")({
  staticData: { breadcrumb: "Dashboards" },
  head: () => ({ meta: [{ title: "Everr - Dashboards" }] }),
  component: DashboardsIndexPage,
});

function DashboardsIndexPage() {
  const { data: dashboards, isLoading, isError, error } = useQuery(dashboardListOptions());
  const [search, setSearch] = useState("");
  const isEmpty = !isLoading && !isError && (dashboards?.length ?? 0) === 0;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <LayoutDashboard className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Dashboards</h1>
      </div>

      <div className="relative mb-4 max-w-sm">
        <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search dashboards..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!isLoading && isError && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <AlertCircle className="size-10" />
          <p className="text-sm">
            {error instanceof Error ? error.message : "Failed to load dashboards"}
          </p>
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <LayoutDashboard className="size-10" />
          <p className="text-sm">No dashboards yet — apply some with the everr CLI</p>
        </div>
      )}

      {!isLoading && !isError && !isEmpty && (
        <DashboardTree dashboards={dashboards ?? []} search={search} />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Regenerate the route tree and typecheck**

Run: `cd packages/app && pnpm exec tsc --noEmit`
Fix any remaining references to deleted symbols (search with `rg`). The TanStack route tree regenerates on dev/build; if a committed `routeTree.gen.ts` exists, run the app's dev/build once to refresh it.
Expected: no type errors across the dashboard surface.

- [ ] **Step 7: Run the full dashboards test suite**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards src/components/dashboards`
Expected: PASS.

- [ ] **Step 8: Verify desktop-app logs route still typechecks (shared types caveat)**

Run: `cd packages/desktop-app && pnpm exec tsc --noEmit`
Expected: PASS (no dashboard types are shared, but this guards the known cross-package gotcha).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(dashboards): read-only render route, grid, tree, and list"
```

---

## Task 11: End-to-end smoke via the apply server function

Confirm the whole path works against the real dev DB before handing off to the CLI plan.

- [ ] **Step 1: Reset dev DB and start the app**

Use the `run` skill (or the project's dev command) to start the app against the reset dev database.

- [ ] **Step 2: Apply a dashboard through the server function**

From a short script or the app's server-fn test harness, call `applyDashboards` with `source: "smoke"` and one document (`team/cpu.yaml` shape: `{ kind: "Dashboard", metadata: { name: "cpu" }, spec: { panels: {}, layouts: [] } }`). Expect `{ created: ["cpu"], updated: [], deleted: [], dryRun: false }`.

- [ ] **Step 3: Verify in the browser**

Use the `verify` skill (reuse the dev server on :5173). Navigate to `/dashboards`, confirm `cpu` appears under folder `team`, open `/dashboards/smoke/cpu`, confirm it renders read-only (no Edit/Add Panel/Save controls).

- [ ] **Step 4: Apply again with the document removed (delete-by-default)**

Call `applyDashboards` with `source: "smoke"` and `documents: []`. Expect `{ created: [], updated: [], deleted: ["cpu"], dryRun: false }`. Reload `/dashboards` and confirm `cpu` is gone.

- [ ] **Step 5: Commit any fixes found during smoke**

```bash
git add -A
git commit -m "fix(dashboards): address gitops read-only smoke findings"
```

(Skip if nothing needed fixing.)

---

## Self-Review Notes (verification of this plan against the spec)

- **Spec §"File format & directory convention":** directory→folder and name-from-`metadata.name`/filename are in Task 2 (`buildDesiredSet`); both YAML and JSON are handled CLI-side (plan 3) — the server receives already-parsed documents, covered by `applyDocumentSchema` (Task 4).
- **Spec §"Identity & multiple sources":** `(org, source, slug)` uniqueness (Task 3), namespaced coexistence + in-source duplicate error (Tasks 2 & 6), source-scoped reconcile load (Task 5).
- **Spec §"Reconcile / prune semantics":** delete-by-default + `dryRun` + transaction (Tasks 1 & 5). No `--prune`/guards, matching the simplified spec.
- **Spec §"Schema changes":** Task 3, including dropping folder objects and `folder_path`.
- **Spec §"What gets removed":** Tasks 8–10 remove every named server fn and component; the kept read-path list matches.
- **Spec §"Routing changes":** `/dashboards/$source/$slug` + not-found reuse (Task 10).
- **Deferred to later plans:** API tokens (plan 2) — Task 5 uses session auth; the Rust CLI + YAML/JSON file reading (plan 3).
