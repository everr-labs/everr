# Dashboard Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist dashboards to Postgres as Perses-compliant JSON blobs, validated via Zod, replacing the in-memory mock data.

**Architecture:** A `dashboard_folders` table for unlimited-depth folder hierarchy and a `dashboards` table with a JSONB `spec` column storing the entire `DashboardSpec`. Server functions handle CRUD. The UI Save button triggers a mutation that persists the zustand store state. Panel edit Apply remains store-only.

**Tech Stack:** Drizzle ORM (Postgres), Zod validation, TanStack Query mutations, TanStack Start server functions, Zustand store.

**Important:** Do not generate Drizzle migrations (`drizzle-kit generate` / `drizzle-kit push`). Schema changes are applied manually.

---

### Task 1: Add database tables to Drizzle schema

**Files:**
- Modify: `packages/app/src/db/schema/app.ts`

- [ ] **Step 1: Add `dashboard_folders` and `dashboards` tables**

Add the following to the end of `packages/app/src/db/schema/app.ts`. First, add `uuid` to the import from `drizzle-orm/pg-core`, and add `import type { DashboardSpec } from "@/data/dashboards/types";` at the top:

```typescript
import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DashboardSpec } from "@/data/dashboards/types";
```

Then append after the `workflowJobs` table:

```typescript
export const dashboardFolders = pgTable(
  "dashboard_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => dashboardFolders.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("dashboard_folders_tenant_parent_name_uq").on(
      table.organizationId,
      sql`COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')`,
      table.name,
    ),
  ],
);

export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    folderId: uuid("folder_id").references(() => dashboardFolders.id, {
      onDelete: "cascade",
    }),
    slug: text("slug").notNull(),
    spec: jsonb("spec").notNull().$type<DashboardSpec>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("dashboards_tenant_slug_uq").on(
      table.organizationId,
      table.slug,
    ),
    index("dashboards_tenant_updated_idx").on(
      table.organizationId,
      sql`updated_at DESC`,
    ),
  ],
);
```

Note: You'll need to import `AnyPgColumn` from `drizzle-orm/pg-core` for the self-referencing FK:

```typescript
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Verify types compile**

Run: `cd packages/app && npx tsc --noEmit`
Expected: No errors related to the new tables.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/db/schema/app.ts
git commit -m "feat(dashboards): add dashboard_folders and dashboards tables to schema"
```

---

### Task 2: Drop `project` from `DashboardMetadata`

**Files:**
- Modify: `packages/app/src/data/dashboards/types.ts`

- [ ] **Step 1: Remove `project` field from `DashboardMetadata`**

Change the interface from:

```typescript
export interface DashboardMetadata {
  name: string;
  project: string;
}
```

To:

```typescript
export interface DashboardMetadata {
  name: string;
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd packages/app && npx tsc --noEmit`

Any file that sets `metadata.project` will now error. Fix each one:

- `packages/app/src/data/dashboards/mock.ts` — remove the `project: "everr"` line from `MOCK_DASHBOARD.metadata`

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/data/dashboards/types.ts packages/app/src/data/dashboards/mock.ts
git commit -m "refactor(dashboards): drop project field from DashboardMetadata"
```

---

### Task 3: Create Zod validation schema

**Files:**
- Create: `packages/app/src/data/dashboards/schema.ts`

- [ ] **Step 1: Create the Zod schema file**

Create `packages/app/src/data/dashboards/schema.ts`:

```typescript
import * as z from "zod";

const pluginSpecValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(pluginSpecValue),
    z.record(pluginSpecValue),
  ]),
);

const dashboardDisplay = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
});

const panelPlugin = z.object({
  kind: z.string(),
  spec: z.record(pluginSpecValue),
});

const queryPlugin = z.object({
  kind: z.string(),
  spec: z.record(pluginSpecValue),
});

const panelQuery = z.object({
  kind: z.string(),
  spec: z.object({
    plugin: queryPlugin,
  }),
});

const panel = z.object({
  kind: z.literal("Panel"),
  spec: z.object({
    display: dashboardDisplay,
    plugin: panelPlugin,
    queries: z.array(panelQuery).optional(),
  }),
});

const gridItem = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  content: z.object({ $ref: z.string() }),
});

const gridLayout = z.object({
  kind: z.literal("Grid"),
  spec: z.object({
    display: z
      .object({
        title: z.string().optional(),
        collapse: z.object({ open: z.boolean() }).optional(),
      })
      .optional(),
    items: z.array(gridItem),
  }),
});

const datasourceSpec = z.object({
  default: z.boolean(),
  plugin: z.object({
    kind: z.string(),
    spec: z.record(pluginSpecValue),
  }),
});

const variableDisplay = dashboardDisplay.extend({
  hidden: z.boolean().optional(),
});

const textVariable = z.object({
  kind: z.literal("TextVariable"),
  spec: z.object({
    name: z.string(),
    display: variableDisplay.optional(),
    value: z.string(),
    constant: z.boolean().optional(),
  }),
});

const listVariable = z.object({
  kind: z.literal("ListVariable"),
  spec: z.object({
    name: z.string(),
    display: variableDisplay.optional(),
    defaultValue: z.union([z.string(), z.array(z.string())]).optional(),
    allowAllValue: z.boolean().optional(),
    allowMultiple: z.boolean().optional(),
    customAllValue: z.string().optional(),
    capturingRegexp: z.string().optional(),
    sort: z
      .enum([
        "none",
        "alphabetical-asc",
        "alphabetical-desc",
        "numerical-asc",
        "numerical-desc",
        "alphabetical-ci-asc",
        "alphabetical-ci-desc",
      ])
      .optional(),
    plugin: z.object({
      kind: z.string(),
      spec: z.record(pluginSpecValue),
    }),
  }),
});

const variable = z.discriminatedUnion("kind", [textVariable, listVariable]);

export const dashboardSpecSchema = z.object({
  display: dashboardDisplay.optional(),
  datasources: z.record(datasourceSpec).optional(),
  variables: z.array(variable).optional(),
  panels: z.record(panel),
  layouts: z.array(gridLayout),
  duration: z.string().optional(),
  refreshInterval: z.string().optional(),
});

export const saveDashboardInput = z.object({
  slug: z.string().min(1).max(200),
  spec: dashboardSpecSchema,
  folderId: z.string().uuid().optional(),
});

export const deleteDashboardInput = z.object({
  slug: z.string().min(1),
});

export const createFolderInput = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().uuid().optional(),
});

export const renameFolderInput = z.object({
  folderId: z.string().uuid(),
  name: z.string().min(1).max(200),
});

export const deleteFolderInput = z.object({
  folderId: z.string().uuid(),
  mode: z.enum(["cascade", "move-to-root"]),
});
```

- [ ] **Step 2: Verify types compile**

Run: `cd packages/app && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/data/dashboards/schema.ts
git commit -m "feat(dashboards): add Zod validation schema for dashboard spec"
```

---

### Task 4: Rewrite server functions for database persistence

**Files:**
- Modify: `packages/app/src/data/dashboards/server.ts`

- [ ] **Step 1: Rewrite server.ts with real CRUD**

Replace the entire contents of `packages/app/src/data/dashboards/server.ts` with:

```typescript
import { and, eq, isNull } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db/client";
import { dashboardFolders, dashboards } from "@/db/schema";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { DEFAULT_TIME_RANGE, resolveTimeRange } from "@/lib/time-range";
import {
  createFolderInput,
  dashboardSpecSchema,
  deleteDashboardInput,
  deleteFolderInput,
  renameFolderInput,
  saveDashboardInput,
} from "./schema";
import type { Dashboard } from "./types";

export const getDashboard = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ dashboardId: z.string() }))
  .handler(async ({ data: { dashboardId }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    const [row] = await db
      .select({ slug: dashboards.slug, spec: dashboards.spec })
      .from(dashboards)
      .where(
        and(
          eq(dashboards.organizationId, orgId),
          eq(dashboards.slug, dashboardId),
        ),
      )
      .limit(1);

    if (!row) {
      throw new Error(`Dashboard "${dashboardId}" not found`);
    }

    const spec = dashboardSpecSchema.parse(row.spec);

    return {
      kind: "Dashboard",
      metadata: { name: row.slug },
      spec,
    } satisfies Dashboard;
  });

export const saveDashboard = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(saveDashboardInput)
  .handler(async ({ data: { slug, spec, folderId }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    const [existing] = await db
      .select({ id: dashboards.id })
      .from(dashboards)
      .where(
        and(
          eq(dashboards.organizationId, orgId),
          eq(dashboards.slug, slug),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(dashboards)
        .set({ spec, folderId: folderId ?? null, updatedAt: new Date() })
        .where(eq(dashboards.id, existing.id));
    } else {
      await db.insert(dashboards).values({
        organizationId: orgId,
        slug,
        spec,
        folderId: folderId ?? null,
      });
    }

    return { slug };
  });

export const deleteDashboard = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(deleteDashboardInput)
  .handler(async ({ data: { slug }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    await db
      .delete(dashboards)
      .where(
        and(
          eq(dashboards.organizationId, orgId),
          eq(dashboards.slug, slug),
        ),
      );

    return { deleted: true };
  });

export const listFolders = createAuthenticatedServerFn({
  method: "GET",
})
  .handler(async ({ context }) => {
    const orgId = context.session.session.activeOrganizationId;

    return db
      .select({
        id: dashboardFolders.id,
        parentId: dashboardFolders.parentId,
        name: dashboardFolders.name,
      })
      .from(dashboardFolders)
      .where(eq(dashboardFolders.organizationId, orgId));
  });

export const createFolder = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(createFolderInput)
  .handler(async ({ data: { name, parentId }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    const [row] = await db
      .insert(dashboardFolders)
      .values({
        organizationId: orgId,
        parentId: parentId ?? null,
        name,
      })
      .returning({ id: dashboardFolders.id });

    return { id: row!.id };
  });

export const renameFolder = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(renameFolderInput)
  .handler(async ({ data: { folderId, name }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    await db
      .update(dashboardFolders)
      .set({ name, updatedAt: new Date() })
      .where(
        and(
          eq(dashboardFolders.id, folderId),
          eq(dashboardFolders.organizationId, orgId),
        ),
      );

    return { id: folderId };
  });

export const deleteFolder = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(deleteFolderInput)
  .handler(async ({ data: { folderId, mode }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    if (mode === "move-to-root") {
      await db.transaction(async (tx) => {
        await tx
          .update(dashboards)
          .set({ folderId: null })
          .where(
            and(
              eq(dashboards.organizationId, orgId),
              eq(dashboards.folderId, folderId),
            ),
          );

        await tx
          .update(dashboardFolders)
          .set({ parentId: null })
          .where(
            and(
              eq(dashboardFolders.organizationId, orgId),
              eq(dashboardFolders.parentId, folderId),
            ),
          );

        await tx
          .delete(dashboardFolders)
          .where(
            and(
              eq(dashboardFolders.id, folderId),
              eq(dashboardFolders.organizationId, orgId),
            ),
          );
      });
    } else {
      await db
        .delete(dashboardFolders)
        .where(
          and(
            eq(dashboardFolders.id, folderId),
            eq(dashboardFolders.organizationId, orgId),
          ),
        );
    }

    return { deleted: true };
  });

type QueryRow = Record<string, string | number | boolean | null>;

export const runPanelQuery = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      sql: z.string().min(1),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
  )
  .handler(async ({ data: { sql, from, to }, context }) => {
    const { fromISO, toISO } = resolveTimeRange({
      from: from ?? DEFAULT_TIME_RANGE.from,
      to: to ?? DEFAULT_TIME_RANGE.to,
    });
    const rows = await context.clickhouse.query<QueryRow>(sql, {
      from: fromISO,
      to: toISO,
    });
    return { rows };
  });
```

- [ ] **Step 2: Verify types compile**

Run: `cd packages/app && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/data/dashboards/server.ts
git commit -m "feat(dashboards): rewrite server functions for database persistence"
```

---

### Task 5: Delete mock data

**Files:**
- Delete: `packages/app/src/data/dashboards/mock.ts`

- [ ] **Step 1: Delete mock.ts**

```bash
rm packages/app/src/data/dashboards/mock.ts
```

- [ ] **Step 2: Verify types compile**

Run: `cd packages/app && npx tsc --noEmit`
Expected: No errors. The only import of `mock.ts` was in `server.ts`, which was rewritten in Task 4.

- [ ] **Step 3: Commit**

```bash
git add -u packages/app/src/data/dashboards/mock.ts
git commit -m "refactor(dashboards): remove mock dashboard data"
```

---

### Task 6: Add mutation hooks to options.ts

**Files:**
- Modify: `packages/app/src/data/dashboards/options.ts`

- [ ] **Step 1: Add mutation hooks**

Replace the entire contents of `packages/app/src/data/dashboards/options.ts` with:

```typescript
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createFolder,
  deleteFolder,
  getDashboard,
  renameFolder,
  runPanelQuery,
  saveDashboard,
  deleteDashboard,
} from "./server";

const dashboardsQueryKey = ["dashboards"] as const;

export const dashboardOptions = (dashboardId: string) =>
  queryOptions({
    queryKey: [...dashboardsQueryKey, dashboardId],
    queryFn: () => getDashboard({ data: { dashboardId } }),
  });

export const panelQueryOptions = (sql: string, from?: string, to?: string) =>
  queryOptions({
    queryKey: ["panel-query", sql, from, to],
    queryFn: () => runPanelQuery({ data: { sql, from, to } }),
    enabled: sql.trim().length > 0,
  });

export function useSaveDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      slug: string;
      spec: Parameters<typeof saveDashboard>[0]["data"]["spec"];
      folderId?: string;
    }) => saveDashboard({ data: vars }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: [...dashboardsQueryKey, vars.slug],
      });
      toast.success("Dashboard saved");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    },
  });
}

export function useDeleteDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => deleteDashboard({ data: { slug } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardsQueryKey });
      toast.success("Dashboard deleted");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete");
    },
  });
}

const foldersQueryKey = ["dashboard-folders"] as const;

export function useFoldersList() {
  // Placeholder for future folder list page — returns queryOptions shape
  return queryOptions({
    queryKey: foldersQueryKey,
    queryFn: () => import("./server").then((m) => m.listFolders()),
    enabled: false,
  });
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; parentId?: string }) =>
      createFolder({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: foldersQueryKey });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to create folder",
      );
    },
  });
}

export function useRenameFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { folderId: string; name: string }) =>
      renameFolder({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: foldersQueryKey });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to rename folder",
      );
    },
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      folderId: string;
      mode: "cascade" | "move-to-root";
    }) => deleteFolder({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: foldersQueryKey });
      void qc.invalidateQueries({ queryKey: dashboardsQueryKey });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete folder",
      );
    },
  });
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd packages/app && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/data/dashboards/options.ts
git commit -m "feat(dashboards): add mutation hooks for dashboard and folder CRUD"
```

---

### Task 7: Wire up Save button in dashboard grid

**Files:**
- Modify: `packages/app/src/components/dashboards/dashboard-grid.tsx`

- [ ] **Step 1: Replace mock save with real mutation**

In `packages/app/src/components/dashboards/dashboard-grid.tsx`:

1. Add import at the top:
```typescript
import { useSaveDashboard } from "@/data/dashboards/options";
```

2. Inside `DashboardGrid`, after the existing store hooks, add the mutation:
```typescript
const saveMutation = useSaveDashboard();
```

3. Replace the existing `handleSave` callback:

From:
```typescript
const handleSave = useCallback(() => {
  toast.info("Dashboard saved (mock — no persistence yet)");
}, []);
```

To:
```typescript
const handleSave = useCallback(() => {
  if (!dashboard) return;
  saveMutation.mutate({
    slug: dashboard.metadata.name,
    spec: dashboard.spec,
  });
}, [dashboard, saveMutation]);
```

4. Remove the `toast` import from `sonner` if it's no longer used elsewhere in this file. Check: `toast` is used only in `handleSave`, and the mutation hooks in `options.ts` now handle toasts. So remove `import { toast } from "sonner";`.

5. Update the Save button to show loading state. Change:
```typescript
<Button size="sm" onClick={handleSave}>
  <Save data-icon="inline-start" />
  Save
</Button>
```
To:
```typescript
<Button
  size="sm"
  onClick={handleSave}
  disabled={saveMutation.isPending}
>
  <Save data-icon="inline-start" />
  {saveMutation.isPending ? "Saving…" : "Save"}
</Button>
```

- [ ] **Step 2: Verify types compile**

Run: `cd packages/app && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/dashboards/dashboard-grid.tsx
git commit -m "feat(dashboards): wire Save button to saveDashboard mutation"
```

---

### Task 8: Handle dashboard not found in route

**Files:**
- Modify: `packages/app/src/routes/_authenticated/_dashboard/dashboards.$dashboardId.tsx`

- [ ] **Step 1: Add error boundary for not-found**

The `getDashboard` server function now throws when the dashboard doesn't exist. TanStack Router's `loader` will propagate the error. Add an `errorComponent` to handle it gracefully.

In `packages/app/src/routes/_authenticated/_dashboard/dashboards.$dashboardId.tsx`, update the route definition:

```typescript
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import { dashboardOptions } from "@/data/dashboards/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboards/$dashboardId",
)({
  staticData: { breadcrumb: "Dashboard" },
  head: () => ({
    meta: [{ title: "Everr - Dashboard" }],
  }),
  component: DashboardPage,
  errorComponent: DashboardNotFound,
  loader: async ({ context: { queryClient }, params: { dashboardId } }) => {
    await queryClient.prefetchQuery(dashboardOptions(dashboardId));
  },
});

function DashboardNotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <p className="text-lg">Dashboard not found</p>
      <Link to="/dashboards" className="text-sm underline">
        Back to dashboards
      </Link>
    </div>
  );
}

function DashboardPage() {
  const { dashboardId } = Route.useParams();
  const { data } = useSuspenseQuery(dashboardOptions(dashboardId));
  const setDashboard = useDashboardStore((s) => s.setDashboard);
  const dashboard = useDashboardStore((s) => s.dashboard);

  useEffect(() => {
    if (!dashboard || dashboard.metadata.name !== data.metadata.name) {
      setDashboard(data);
    }
  }, [data, dashboard, setDashboard]);

  if (!dashboard) return null;

  return <DashboardGrid />;
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd packages/app && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/routes/_authenticated/_dashboard/dashboards.\$dashboardId.tsx
git commit -m "feat(dashboards): add error component for dashboard not found"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `dashboard_folders` table with self-ref FK, CASCADE, COALESCE unique index | Task 1 |
| `dashboards` table with JSONB spec, folder FK, slug unique index | Task 1 |
| Drop `metadata.project` from `DashboardMetadata` | Task 2 |
| Zod `dashboardSpecSchema` mirroring `DashboardSpec` with `z.lazy()` | Task 3 |
| All input schemas (`saveDashboardInput`, `deleteDashboardInput`, folder inputs) | Task 3 |
| `getDashboard` — SELECT by org + slug, throws if not found, validates via Zod | Task 4 |
| `saveDashboard` — upsert by org + slug | Task 4 |
| `deleteDashboard` — DELETE by org + slug | Task 4 |
| `listFolders` — flat list for org | Task 4 |
| `createFolder` — INSERT with parentId | Task 4 |
| `renameFolder` — UPDATE name | Task 4 |
| `deleteFolder` — cascade or move-to-root in transaction | Task 4 |
| `runPanelQuery` — unchanged | Task 4 |
| Remove `mock.ts` | Task 5 |
| Mutation hooks: `useSaveDashboard`, `useDeleteDashboard`, folder mutations | Task 6 |
| Save button calls mutation, invalidates cache, shows toast | Task 7 |
| Panel edit Apply — store only, no DB call (unchanged) | N/A (already works this way) |
| Dashboard route — not-found handling | Task 8 |

**Placeholder scan:** No TBDs, TODOs, or vague instructions found.

**Type consistency:** `saveDashboard` input uses `slug` + `spec` + `folderId?` consistently across schema.ts, server.ts, options.ts, and dashboard-grid.tsx. `getDashboard` uses `dashboardId` as the param name throughout (maps to `slug` in DB). `Dashboard` type returned by `getDashboard` uses `metadata.name` (no `project`).
