# Dashboard Folders & Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing dashboard-folders data layer in the UI — a nested tree list on `/dashboards`, plus rename/move/delete for dashboards and folders from both the list and the dashboard page.

**Architecture:** Pure tree-building utilities in `data/dashboards/tree.ts` (unit-tested), three new small server fns (`renameDashboard`, `moveDashboard`, `moveFolder`) so list-page actions never round-trip a full dashboard spec, and a set of small shared dialog components composed by a `DashboardTree` component that replaces the card grid on the index page. The dashboard page toolbar gains a kebab menu reusing the same dialogs.

**Tech Stack:** TanStack Start server fns + React Query, Drizzle (Postgres), zod v4 (`import * as z from "zod"`), shadcn/Base UI components from `@everr/ui`, vitest, zustand.

**Spec:** `docs/superpowers/specs/2026-06-05-dashboard-folders-management-design.md`

**Branch:** `gio/dashboard-folders-management` (stacked on `gio/perses-dashboard-route`)

**Important repo rules:**
- Never mention Claude/AI in commit messages. No `Co-Authored-By: Claude` lines.
- Do NOT generate Drizzle migrations (none are needed here anyway — no schema changes).
- Never use `tsx` to run scripts.

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/app/src/data/dashboards/tree.ts` | Create | Pure tree-building/search/count utilities |
| `packages/app/src/data/dashboards/tree.test.ts` | Create | Unit tests for tree utilities |
| `packages/app/src/data/dashboards/schema.ts` | Modify | New input validators |
| `packages/app/src/data/dashboards/server.ts` | Modify | `renameDashboard`, `moveDashboard`, `moveFolder`; `listDashboards` returns `folderId`; `saveDashboard` stops resetting `folder_id` |
| `packages/app/src/data/dashboards/options.ts` | Modify | `folderListOptions`, `useRenameDashboard`, `useMoveDashboard`, `useMoveFolder` |
| `packages/app/src/components/dashboards/name-dialog.tsx` | Create | Generic name-input dialog (create/rename) |
| `packages/app/src/components/dashboards/folder-picker.tsx` | Create | `FolderList` (inline indented list) + `FolderPickerDialog` |
| `packages/app/src/components/dashboards/delete-dashboard-dialog.tsx` | Create | Confirm dialog for dashboard deletion |
| `packages/app/src/components/dashboards/delete-folder-dialog.tsx` | Create | Folder deletion with cascade / move-to-root choice |
| `packages/app/src/components/dashboards/dashboard-tree.tsx` | Create | Tree rows, kebab menus, action-dialog orchestration |
| `packages/app/src/routes/_authenticated/_dashboard/dashboards/index.tsx` | Modify | Replace card grid with tree; New Folder button |
| `packages/app/src/components/dashboards/dashboard-grid.tsx` | Modify | Toolbar kebab (rename/move/delete); folder picker in save dialog |
| `packages/app/src/routes/_authenticated/_dashboard/dashboards/new.tsx` | Modify | `?folder=<uuid>` search param |

Commands run from the repo root. The app package is `@everr/app`.

- Targeted tests: `pnpm --filter @everr/app exec vitest run src/data/dashboards/tree.test.ts`
- Typecheck: `pnpm --filter @everr/app typecheck`
- Dev server: `pnpm --filter @everr/app dev`

---

### Task 1: Tree utilities (TDD)

**Files:**
- Create: `packages/app/src/data/dashboards/tree.ts`
- Test: `packages/app/src/data/dashboards/tree.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/app/src/data/dashboards/tree.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildTree,
  countFolderContents,
  descendantFolderIds,
  flattenFolders,
  folderPath,
  searchItems,
  type DashboardSummary,
  type FolderSummary,
} from "./tree";

const folders: FolderSummary[] = [
  { id: "f-prod", parentId: null, name: "Production" },
  { id: "f-api", parentId: "f-prod", name: "API" },
  { id: "f-staging", parentId: null, name: "Staging" },
];

const dashboards: DashboardSummary[] = [
  { slug: "request-rate", name: "Request Rate", folderId: "f-api" },
  { slug: "error-budget", name: "Error Budget", folderId: "f-api" },
  { slug: "overview", name: "Overview", folderId: "f-prod" },
  { slug: "scratch", name: "Scratch", folderId: null },
];

describe("buildTree", () => {
  it("nests folders by parentId and dashboards by folderId", () => {
    const tree = buildTree(folders, dashboards);
    expect(tree.folders.map((n) => n.folder.id)).toEqual([
      "f-prod",
      "f-staging",
    ]);
    const prod = tree.folders[0];
    expect(prod?.subfolders.map((n) => n.folder.id)).toEqual(["f-api"]);
    expect(prod?.dashboards.map((d) => d.slug)).toEqual(["overview"]);
    expect(prod?.subfolders[0]?.dashboards.map((d) => d.slug)).toEqual([
      "error-budget",
      "request-rate",
    ]);
    expect(tree.dashboards.map((d) => d.slug)).toEqual(["scratch"]);
  });

  it("sorts folders and dashboards alphabetically within a level", () => {
    const tree = buildTree(
      [
        { id: "b", parentId: null, name: "Bravo" },
        { id: "a", parentId: null, name: "alpha" },
      ],
      [
        { slug: "z", name: "Zulu", folderId: null },
        { slug: "y", name: "yankee", folderId: null },
      ],
    );
    expect(tree.folders.map((n) => n.folder.name)).toEqual(["alpha", "Bravo"]);
    expect(tree.dashboards.map((d) => d.name)).toEqual(["yankee", "Zulu"]);
  });

  it("places orphaned items at root instead of dropping them", () => {
    const tree = buildTree(
      [{ id: "f-lost", parentId: "missing", name: "Lost" }],
      [{ slug: "d-lost", name: "Lost Dash", folderId: "missing" }],
    );
    expect(tree.folders.map((n) => n.folder.id)).toEqual(["f-lost"]);
    expect(tree.dashboards.map((d) => d.slug)).toEqual(["d-lost"]);
  });
});

describe("flattenFolders", () => {
  it("returns depth-first order with depths", () => {
    expect(
      flattenFolders(folders).map(({ folder, depth }) => [folder.id, depth]),
    ).toEqual([
      ["f-prod", 0],
      ["f-api", 1],
      ["f-staging", 0],
    ]);
  });
});

describe("descendantFolderIds", () => {
  it("includes the folder itself and all descendants", () => {
    const deep: FolderSummary[] = [
      ...folders,
      { id: "f-api-internal", parentId: "f-api", name: "Internal" },
    ];
    expect(descendantFolderIds(deep, "f-prod")).toEqual(
      new Set(["f-prod", "f-api", "f-api-internal"]),
    );
    expect(descendantFolderIds(deep, "f-staging")).toEqual(
      new Set(["f-staging"]),
    );
  });
});

describe("countFolderContents", () => {
  it("counts dashboards and subfolders recursively", () => {
    expect(countFolderContents(folders, dashboards, "f-prod")).toEqual({
      folders: 1,
      dashboards: 3,
    });
    expect(countFolderContents(folders, dashboards, "f-staging")).toEqual({
      folders: 0,
      dashboards: 0,
    });
  });
});

describe("folderPath", () => {
  it("joins ancestor names from root", () => {
    expect(folderPath(folders, "f-api")).toBe("Production / API");
    expect(folderPath(folders, "f-prod")).toBe("Production");
    expect(folderPath(folders, null)).toBe("");
  });
});

describe("searchItems", () => {
  it("matches dashboards and folders case-insensitively with paths", () => {
    const result = searchItems(folders, dashboards, "rate");
    expect(result.dashboards.map((m) => m.dashboard.slug)).toEqual([
      "request-rate",
    ]);
    expect(result.dashboards[0]?.path).toBe("Production / API");
    expect(result.folders).toEqual([]);

    const folderResult = searchItems(folders, dashboards, "api");
    expect(folderResult.folders.map((m) => m.folder.id)).toEqual(["f-api"]);
    expect(folderResult.folders[0]?.path).toBe("Production");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @everr/app exec vitest run src/data/dashboards/tree.test.ts`
Expected: FAIL — cannot resolve `./tree`.

- [ ] **Step 3: Implement the tree module**

Create `packages/app/src/data/dashboards/tree.ts`:

```ts
export interface FolderSummary {
  id: string;
  parentId: string | null;
  name: string;
}

export interface DashboardSummary {
  slug: string;
  name: string;
  folderId: string | null;
}

export interface FolderNode {
  folder: FolderSummary;
  subfolders: FolderNode[];
  dashboards: DashboardSummary[];
}

export interface DashboardTree {
  folders: FolderNode[];
  dashboards: DashboardSummary[];
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);

export function buildTree(
  folders: FolderSummary[],
  dashboards: DashboardSummary[],
): DashboardTree {
  const folderIds = new Set(folders.map((f) => f.id));
  // Orphans (parent/folder id pointing at a non-existent folder) fall back to
  // root rather than disappearing.
  const resolveParent = (id: string | null) =>
    id !== null && folderIds.has(id) ? id : null;

  const childFolders = new Map<string | null, FolderSummary[]>();
  for (const folder of folders) {
    const parentId = resolveParent(folder.parentId);
    childFolders.set(parentId, [...(childFolders.get(parentId) ?? []), folder]);
  }

  const childDashboards = new Map<string | null, DashboardSummary[]>();
  for (const dashboard of dashboards) {
    const folderId = resolveParent(dashboard.folderId);
    childDashboards.set(folderId, [
      ...(childDashboards.get(folderId) ?? []),
      dashboard,
    ]);
  }

  const build = (parentId: string | null): FolderNode[] =>
    [...(childFolders.get(parentId) ?? [])].sort(byName).map((folder) => ({
      folder,
      subfolders: build(folder.id),
      dashboards: [...(childDashboards.get(folder.id) ?? [])].sort(byName),
    }));

  return {
    folders: build(null),
    dashboards: [...(childDashboards.get(null) ?? [])].sort(byName),
  };
}

export interface FlatFolder {
  folder: FolderSummary;
  depth: number;
}

export function flattenFolders(folders: FolderSummary[]): FlatFolder[] {
  const out: FlatFolder[] = [];
  const walk = (nodes: FolderNode[], depth: number) => {
    for (const node of nodes) {
      out.push({ folder: node.folder, depth });
      walk(node.subfolders, depth + 1);
    }
  };
  walk(buildTree(folders, []).folders, 0);
  return out;
}

export function descendantFolderIds(
  folders: FolderSummary[],
  folderId: string,
): Set<string> {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parentId !== null) {
      children.set(folder.parentId, [
        ...(children.get(folder.parentId) ?? []),
        folder.id,
      ]);
    }
  }
  const result = new Set<string>([folderId]);
  const stack = [folderId];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    for (const childId of children.get(id) ?? []) {
      if (!result.has(childId)) {
        result.add(childId);
        stack.push(childId);
      }
    }
  }
  return result;
}

export function countFolderContents(
  folders: FolderSummary[],
  dashboards: DashboardSummary[],
  folderId: string,
): { folders: number; dashboards: number } {
  const ids = descendantFolderIds(folders, folderId);
  return {
    folders: ids.size - 1,
    dashboards: dashboards.filter(
      (d) => d.folderId !== null && ids.has(d.folderId),
    ).length,
  };
}

export function folderPath(
  folders: FolderSummary[],
  folderId: string | null,
): string {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const names: string[] = [];
  let current = folderId === null ? undefined : byId.get(folderId);
  while (current) {
    names.unshift(current.name);
    current =
      current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return names.join(" / ");
}

export interface SearchResults {
  folders: { folder: FolderSummary; path: string }[];
  dashboards: { dashboard: DashboardSummary; path: string }[];
}

export function searchItems(
  folders: FolderSummary[],
  dashboards: DashboardSummary[],
  query: string,
): SearchResults {
  const q = query.trim().toLowerCase();
  return {
    folders: folders
      .filter((f) => f.name.toLowerCase().includes(q))
      .sort(byName)
      .map((folder) => ({ folder, path: folderPath(folders, folder.parentId) })),
    dashboards: dashboards
      .filter((d) => d.name.toLowerCase().includes(q))
      .sort(byName)
      .map((dashboard) => ({
        dashboard,
        path: folderPath(folders, dashboard.folderId),
      })),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @everr/app exec vitest run src/data/dashboards/tree.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/data/dashboards/tree.ts packages/app/src/data/dashboards/tree.test.ts
git commit -m "feat(dashboards): add folder tree building utilities"
```

---

### Task 2: Server fns and input validators

**Files:**
- Modify: `packages/app/src/data/dashboards/schema.ts` (append after `deleteFolderInput`, ~line 186)
- Modify: `packages/app/src/data/dashboards/server.ts`

There are no server-fn tests in this codebase (server fns require an authenticated session + DB); these are verified by typecheck now and the browser walkthrough in Task 10.

- [ ] **Step 1: Add input validators to `schema.ts`**

Append after `deleteFolderInput`:

```ts
export const renameDashboardInput = z.object({
  slug: z.string().min(1),
  name: z.string().min(1).max(200),
});

export const moveDashboardInput = z.object({
  slug: z.string().min(1),
  folderId: z.string().uuid().nullable(),
});

export const moveFolderInput = z.object({
  folderId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
});
```

- [ ] **Step 2: Return `folderId` from `listDashboards`**

In `server.ts`, update the `listDashboards` handler (currently selects only `slug` + `displayName`):

```ts
export const listDashboards = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context }) => {
  const orgId = context.session.session.activeOrganizationId;

  const rows = await db
    .select({
      slug: dashboards.slug,
      folderId: dashboards.folderId,
      displayName: sql<string>`spec->'display'->>'name'`,
    })
    .from(dashboards)
    .where(eq(dashboards.organizationId, orgId));

  return rows.map((r) => ({
    slug: r.slug,
    name: r.displayName ?? r.slug,
    folderId: r.folderId,
  }));
});
```

- [ ] **Step 3: Stop `saveDashboard` from resetting `folder_id`**

Bug found during design: the existing-dashboard `Save` button calls `saveDashboard` without `folderId`, and the update branch sets `folderId: folderId ?? null` — once dashboards live in folders, every Save would silently move the dashboard back to root. Change the update branch so `folder_id` is only touched when `folderId` is explicitly provided:

```ts
    if (existing) {
      await db
        .update(dashboards)
        .set({
          spec: spec as DashboardSpec,
          updatedAt: new Date(),
          ...(folderId !== undefined ? { folderId } : {}),
        })
        .where(eq(dashboards.id, existing.id));
    } else {
```

(The insert branch keeps `folderId: folderId ?? null`.)

- [ ] **Step 4: Add the three new server fns**

In `server.ts`, extend the schema import:

```ts
import {
  createFolderInput,
  dashboardSpecSchema,
  deleteDashboardInput,
  deleteFolderInput,
  moveDashboardInput,
  moveFolderInput,
  renameDashboardInput,
  renameFolderInput,
  saveDashboardInput,
} from "./schema";
```

Add after `deleteDashboard`:

```ts
export const renameDashboard = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(renameDashboardInput)
  .handler(async ({ data: { slug, name }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    const [row] = await db
      .select({ id: dashboards.id, spec: dashboards.spec })
      .from(dashboards)
      .where(
        and(eq(dashboards.organizationId, orgId), eq(dashboards.slug, slug)),
      )
      .limit(1);

    if (!row) {
      throw new Error(`Dashboard "${slug}" not found`);
    }

    await db
      .update(dashboards)
      .set({
        spec: { ...row.spec, display: { ...row.spec.display, name } },
        updatedAt: new Date(),
      })
      .where(eq(dashboards.id, row.id));

    return { slug, name };
  });

export const moveDashboard = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(moveDashboardInput)
  .handler(async ({ data: { slug, folderId }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    if (folderId !== null) {
      const [folder] = await db
        .select({ id: dashboardFolders.id })
        .from(dashboardFolders)
        .where(
          and(
            eq(dashboardFolders.id, folderId),
            eq(dashboardFolders.organizationId, orgId),
          ),
        )
        .limit(1);
      if (!folder) {
        throw new Error("Target folder not found");
      }
    }

    await db
      .update(dashboards)
      .set({ folderId, updatedAt: new Date() })
      .where(
        and(eq(dashboards.organizationId, orgId), eq(dashboards.slug, slug)),
      );

    return { slug };
  });
```

Add after `renameFolder`:

```ts
export const moveFolder = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(moveFolderInput)
  .handler(async ({ data: { folderId, parentId }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    // Cycle check: walk up from the target parent; if we reach the folder
    // being moved, the move would create a cycle.
    let current = parentId;
    while (current !== null) {
      if (current === folderId) {
        throw new Error(
          "Cannot move a folder into itself or one of its subfolders",
        );
      }
      const [row] = await db
        .select({ parentId: dashboardFolders.parentId })
        .from(dashboardFolders)
        .where(
          and(
            eq(dashboardFolders.id, current),
            eq(dashboardFolders.organizationId, orgId),
          ),
        )
        .limit(1);
      if (!row) {
        throw new Error("Target folder not found");
      }
      current = row.parentId;
    }

    await db
      .update(dashboardFolders)
      .set({ parentId, updatedAt: new Date() })
      .where(
        and(
          eq(dashboardFolders.id, folderId),
          eq(dashboardFolders.organizationId, orgId),
        ),
      );

    return { id: folderId };
  });
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @everr/app typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/data/dashboards/schema.ts packages/app/src/data/dashboards/server.ts
git commit -m "feat(dashboards): add rename/move server fns, folder id in list, preserve folder on save"
```

---

### Task 3: Query options and mutation hooks

**Files:**
- Modify: `packages/app/src/data/dashboards/options.ts`

- [ ] **Step 1: Add imports, folder list options, and mutation hooks**

Extend the `./server` import:

```ts
import {
  createFolder,
  deleteDashboard,
  deleteFolder,
  getDashboard,
  listDashboards,
  listFolders,
  moveDashboard,
  moveFolder,
  renameDashboard,
  renameFolder,
  runPanelQuery,
  saveDashboard,
} from "./server";
```

Move the `const foldersQueryKey = ["dashboard-folders"] as const;` declaration up next to `dashboardsQueryKey` (line 18), then add after `dashboardListOptions`:

```ts
export const folderListOptions = () =>
  queryOptions({
    queryKey: foldersQueryKey,
    queryFn: () => listFolders(),
  });
```

Add after `useDeleteDashboard`:

```ts
export function useRenameDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { slug: string; name: string }) =>
      renameDashboard({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardsQueryKey });
      toast.success("Dashboard renamed");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to rename");
    },
  });
}

export function useMoveDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { slug: string; folderId: string | null }) =>
      moveDashboard({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardsQueryKey });
      toast.success("Dashboard moved");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to move");
    },
  });
}
```

Add after `useRenameFolder`:

```ts
export function useMoveFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { folderId: string; parentId: string | null }) =>
      moveFolder({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: foldersQueryKey });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to move folder",
      );
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @everr/app typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/data/dashboards/options.ts
git commit -m "feat(dashboards): add folder list query and rename/move mutation hooks"
```

---

### Task 4: NameDialog component

**Files:**
- Create: `packages/app/src/components/dashboards/name-dialog.tsx`

A single generic name-input dialog used for: create folder, create subfolder, rename folder, rename dashboard. No component-test infrastructure exists in this repo — verified via browser in later tasks.

- [ ] **Step 1: Create the component**

```tsx
import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useEffect, useState } from "react";

interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  initialName?: string;
  confirmLabel: string;
  isPending?: boolean;
  onConfirm: (name: string) => void;
}

export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  initialName = "",
  confirmLabel,
  isPending,
  onConfirm,
}: NameDialogProps) {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  const handleConfirm = () => {
    if (name.trim()) onConfirm(name.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="name-dialog-input">Name</Label>
          <Input
            id="name-dialog-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm();
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!name.trim() || isPending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @everr/app typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/dashboards/name-dialog.tsx
git commit -m "feat(dashboards): add generic name dialog"
```

---

### Task 5: FolderList and FolderPickerDialog

**Files:**
- Create: `packages/app/src/components/dashboards/folder-picker.tsx`

`FolderList` is the inline indented folder list (also embedded directly in the save dialog in Task 9); `FolderPickerDialog` wraps it with confirm/cancel for move operations.

- [ ] **Step 1: Create the component**

```tsx
import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { cn } from "@everr/ui/lib/utils";
import { Folder, House } from "lucide-react";
import { useEffect, useState } from "react";
import { flattenFolders, type FolderSummary } from "@/data/dashboards/tree";

interface FolderListProps {
  folders: FolderSummary[];
  value: string | null;
  onChange: (folderId: string | null) => void;
  disabledIds?: Set<string>;
}

export function FolderList({
  folders,
  value,
  onChange,
  disabledIds,
}: FolderListProps) {
  return (
    <div className="border-border max-h-64 overflow-y-auto rounded-md border p-1">
      <FolderRow
        name="Root"
        icon={<House className="size-3.5 text-muted-foreground" />}
        depth={0}
        selected={value === null}
        onClick={() => onChange(null)}
      />
      {flattenFolders(folders).map(({ folder, depth }) => (
        <FolderRow
          key={folder.id}
          name={folder.name}
          icon={<Folder className="size-3.5 text-muted-foreground" />}
          depth={depth + 1}
          selected={value === folder.id}
          disabled={disabledIds?.has(folder.id)}
          onClick={() => onChange(folder.id)}
        />
      ))}
    </div>
  );
}

function FolderRow({
  name,
  icon,
  depth,
  selected,
  disabled,
  onClick,
}: {
  name: string;
  icon: React.ReactNode;
  depth: number;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
        disabled && "pointer-events-none opacity-50",
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      {icon}
      <span className="truncate">{name}</span>
    </button>
  );
}

interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  folders: FolderSummary[];
  initialFolderId?: string | null;
  disabledIds?: Set<string>;
  confirmLabel?: string;
  isPending?: boolean;
  onConfirm: (folderId: string | null) => void;
}

export function FolderPickerDialog({
  open,
  onOpenChange,
  title,
  folders,
  initialFolderId = null,
  disabledIds,
  confirmLabel = "Move",
  isPending,
  onConfirm,
}: FolderPickerDialogProps) {
  const [selected, setSelected] = useState<string | null>(initialFolderId);

  useEffect(() => {
    if (open) setSelected(initialFolderId);
  }, [open, initialFolderId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <FolderList
          folders={folders}
          value={selected}
          onChange={setSelected}
          disabledIds={disabledIds}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(selected)} disabled={isPending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @everr/app typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/dashboards/folder-picker.tsx
git commit -m "feat(dashboards): add folder picker components"
```

---

### Task 6: Delete dialogs

**Files:**
- Create: `packages/app/src/components/dashboards/delete-dashboard-dialog.tsx`
- Create: `packages/app/src/components/dashboards/delete-folder-dialog.tsx`

- [ ] **Step 1: Create `delete-dashboard-dialog.tsx`**

`AlertDialogAction` accepts Button props (`variant`, `disabled`).

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@everr/ui/components/alert-dialog";

interface DeleteDashboardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  isPending?: boolean;
  onConfirm: () => void;
}

export function DeleteDashboardDialog({
  open,
  onOpenChange,
  name,
  isPending,
  onConfirm,
}: DeleteDashboardDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete dashboard</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete “{name}”. This action cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isPending}
            onClick={onConfirm}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 2: Create `delete-folder-dialog.tsx`**

Empty folder → single Delete button. Non-empty → explicit choice between the two server modes.

```tsx
import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";

interface DeleteFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  dashboardCount: number;
  folderCount: number;
  isPending?: boolean;
  onConfirm: (mode: "cascade" | "move-to-root") => void;
}

function contentsLabel(dashboardCount: number, folderCount: number): string {
  const parts: string[] = [];
  if (dashboardCount > 0) {
    parts.push(
      `${dashboardCount} dashboard${dashboardCount === 1 ? "" : "s"}`,
    );
  }
  if (folderCount > 0) {
    parts.push(`${folderCount} subfolder${folderCount === 1 ? "" : "s"}`);
  }
  return parts.join(" and ");
}

export function DeleteFolderDialog({
  open,
  onOpenChange,
  name,
  dashboardCount,
  folderCount,
  isPending,
  onConfirm,
}: DeleteFolderDialogProps) {
  const isEmpty = dashboardCount === 0 && folderCount === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete folder</DialogTitle>
          <DialogDescription>
            {isEmpty
              ? `This will delete the empty folder “${name}”.`
              : `“${name}” contains ${contentsLabel(dashboardCount, folderCount)}. Choose what happens to its contents.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {isEmpty ? (
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => onConfirm("cascade")}
            >
              Delete
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => onConfirm("move-to-root")}
              >
                Move contents to root
              </Button>
              <Button
                variant="destructive"
                disabled={isPending}
                onClick={() => onConfirm("cascade")}
              >
                Delete everything
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @everr/app typecheck`
Expected: clean. (`Button` has a `destructive` variant; `AlertDialogAction` accepts Button props.)

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/components/dashboards/delete-dashboard-dialog.tsx packages/app/src/components/dashboards/delete-folder-dialog.tsx
git commit -m "feat(dashboards): add delete confirmation dialogs"
```

---

### Task 7: DashboardTree component

**Files:**
- Create: `packages/app/src/components/dashboards/dashboard-tree.tsx`

Owns: tree rendering, expand/collapse state, search-mode rendering, kebab menus, action-dialog orchestration, mutations.

- [ ] **Step 1: Create the component**

```tsx
import { Button } from "@everr/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  EllipsisVertical,
  Folder,
  FolderInput,
  FolderPlus,
  LayoutDashboard,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  useDeleteDashboard,
  useDeleteFolder,
  useMoveDashboard,
  useMoveFolder,
  useRenameDashboard,
  useRenameFolder,
} from "@/data/dashboards/options";
import {
  buildTree,
  countFolderContents,
  descendantFolderIds,
  searchItems,
  type DashboardSummary,
  type FolderNode,
  type FolderSummary,
} from "@/data/dashboards/tree";
import { DeleteDashboardDialog } from "./delete-dashboard-dialog";
import { DeleteFolderDialog } from "./delete-folder-dialog";
import { FolderPickerDialog } from "./folder-picker";
import { NameDialog } from "./name-dialog";

type TreeAction =
  | { type: "create-subfolder"; folder: FolderSummary }
  | { type: "rename-folder"; folder: FolderSummary }
  | { type: "move-folder"; folder: FolderSummary }
  | { type: "delete-folder"; folder: FolderSummary }
  | { type: "rename-dashboard"; dashboard: DashboardSummary }
  | { type: "move-dashboard"; dashboard: DashboardSummary }
  | { type: "delete-dashboard"; dashboard: DashboardSummary };

interface DashboardTreeProps {
  folders: FolderSummary[];
  dashboards: DashboardSummary[];
  search: string;
  onCreateSubfolder: (parentId: string) => void;
}

export function DashboardTree({
  folders,
  dashboards,
  search,
  onCreateSubfolder,
}: DashboardTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<TreeAction | null>(null);

  const renameDashboard = useRenameDashboard();
  const moveDashboard = useMoveDashboard();
  const deleteDashboard = useDeleteDashboard();
  const renameFolder = useRenameFolder();
  const moveFolder = useMoveFolder();
  const deleteFolder = useDeleteFolder();

  const tree = useMemo(
    () => buildTree(folders, dashboards),
    [folders, dashboards],
  );

  const searching = search.trim().length > 0;
  const results = useMemo(
    () => (searching ? searchItems(folders, dashboards, search) : null),
    [searching, folders, dashboards, search],
  );

  const toggle = (folderId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const handleAction = (next: TreeAction) => {
    if (next.type === "create-subfolder") {
      onCreateSubfolder(next.folder.id);
      return;
    }
    setAction(next);
  };

  const closeAction = () => setAction(null);

  const deleteCounts =
    action?.type === "delete-folder"
      ? countFolderContents(folders, dashboards, action.folder.id)
      : null;

  return (
    <div className="flex flex-col">
      {results ? (
        <>
          {results.folders.map(({ folder, path }) => (
            <SearchFolderRow
              key={folder.id}
              folder={folder}
              path={path}
              onAction={handleAction}
            />
          ))}
          {results.dashboards.map(({ dashboard, path }) => (
            <DashboardRow
              key={dashboard.slug}
              dashboard={dashboard}
              depth={0}
              path={path}
              onAction={handleAction}
            />
          ))}
          {results.folders.length === 0 && results.dashboards.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No dashboards or folders match your search
            </p>
          )}
        </>
      ) : (
        <>
          {tree.folders.map((node) => (
            <FolderRows
              key={node.folder.id}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              onAction={handleAction}
            />
          ))}
          {tree.dashboards.map((dashboard) => (
            <DashboardRow
              key={dashboard.slug}
              dashboard={dashboard}
              depth={0}
              onAction={handleAction}
            />
          ))}
        </>
      )}

      <NameDialog
        open={action?.type === "rename-folder"}
        onOpenChange={(open) => {
          if (!open) closeAction();
        }}
        title="Rename folder"
        initialName={action?.type === "rename-folder" ? action.folder.name : ""}
        confirmLabel="Rename"
        isPending={renameFolder.isPending}
        onConfirm={(name) => {
          if (action?.type !== "rename-folder") return;
          renameFolder.mutate(
            { folderId: action.folder.id, name },
            { onSuccess: closeAction },
          );
        }}
      />

      <NameDialog
        open={action?.type === "rename-dashboard"}
        onOpenChange={(open) => {
          if (!open) closeAction();
        }}
        title="Rename dashboard"
        initialName={
          action?.type === "rename-dashboard" ? action.dashboard.name : ""
        }
        confirmLabel="Rename"
        isPending={renameDashboard.isPending}
        onConfirm={(name) => {
          if (action?.type !== "rename-dashboard") return;
          renameDashboard.mutate(
            { slug: action.dashboard.slug, name },
            { onSuccess: closeAction },
          );
        }}
      />

      <FolderPickerDialog
        open={action?.type === "move-folder"}
        onOpenChange={(open) => {
          if (!open) closeAction();
        }}
        title="Move folder"
        folders={folders}
        initialFolderId={
          action?.type === "move-folder" ? action.folder.parentId : null
        }
        disabledIds={
          action?.type === "move-folder"
            ? descendantFolderIds(folders, action.folder.id)
            : undefined
        }
        isPending={moveFolder.isPending}
        onConfirm={(parentId) => {
          if (action?.type !== "move-folder") return;
          moveFolder.mutate(
            { folderId: action.folder.id, parentId },
            { onSuccess: closeAction },
          );
        }}
      />

      <FolderPickerDialog
        open={action?.type === "move-dashboard"}
        onOpenChange={(open) => {
          if (!open) closeAction();
        }}
        title="Move dashboard"
        folders={folders}
        initialFolderId={
          action?.type === "move-dashboard" ? action.dashboard.folderId : null
        }
        isPending={moveDashboard.isPending}
        onConfirm={(folderId) => {
          if (action?.type !== "move-dashboard") return;
          moveDashboard.mutate(
            { slug: action.dashboard.slug, folderId },
            { onSuccess: closeAction },
          );
        }}
      />

      <DeleteDashboardDialog
        open={action?.type === "delete-dashboard"}
        onOpenChange={(open) => {
          if (!open) closeAction();
        }}
        name={action?.type === "delete-dashboard" ? action.dashboard.name : ""}
        isPending={deleteDashboard.isPending}
        onConfirm={() => {
          if (action?.type !== "delete-dashboard") return;
          deleteDashboard.mutate(action.dashboard.slug, {
            onSuccess: closeAction,
          });
        }}
      />

      <DeleteFolderDialog
        open={action?.type === "delete-folder"}
        onOpenChange={(open) => {
          if (!open) closeAction();
        }}
        name={action?.type === "delete-folder" ? action.folder.name : ""}
        dashboardCount={deleteCounts?.dashboards ?? 0}
        folderCount={deleteCounts?.folders ?? 0}
        isPending={deleteFolder.isPending}
        onConfirm={(mode) => {
          if (action?.type !== "delete-folder") return;
          deleteFolder.mutate(
            { folderId: action.folder.id, mode },
            { onSuccess: closeAction },
          );
        }}
      />
    </div>
  );
}

function FolderRows({
  node,
  depth,
  expanded,
  onToggle,
  onAction,
}: {
  node: FolderNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (folderId: string) => void;
  onAction: (action: TreeAction) => void;
}) {
  const isExpanded = expanded.has(node.folder.id);
  const isEmpty = node.subfolders.length === 0 && node.dashboards.length === 0;

  return (
    <>
      <div
        className="group flex items-center gap-1 rounded-md py-1 pr-1 hover:bg-accent/50"
        style={{ paddingLeft: `${depth * 20 + 4}px` }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
          onClick={() => onToggle(node.folder.id)}
        >
          {isExpanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">
            {node.folder.name}
          </span>
        </button>
        <FolderMenu folder={node.folder} onAction={onAction} />
      </div>
      {isExpanded && (
        <>
          {node.subfolders.map((child) => (
            <FolderRows
              key={child.folder.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onAction={onAction}
            />
          ))}
          {node.dashboards.map((dashboard) => (
            <DashboardRow
              key={dashboard.slug}
              dashboard={dashboard}
              depth={depth + 1}
              onAction={onAction}
            />
          ))}
          {isEmpty && (
            <p
              className="py-1.5 text-xs text-muted-foreground"
              style={{ paddingLeft: `${(depth + 1) * 20 + 26}px` }}
            >
              Empty folder
            </p>
          )}
        </>
      )}
    </>
  );
}

function DashboardRow({
  dashboard,
  depth,
  path,
  onAction,
}: {
  dashboard: DashboardSummary;
  depth: number;
  path?: string;
  onAction: (action: TreeAction) => void;
}) {
  return (
    <div
      className="group flex items-center gap-1 rounded-md py-1 pr-1 hover:bg-accent/50"
      style={{ paddingLeft: `${depth * 20 + 26}px` }}
    >
      <Link
        to="/dashboards/$dashboardId"
        params={{ dashboardId: dashboard.slug }}
        className="flex min-w-0 flex-1 items-center gap-2 py-0.5"
      >
        <LayoutDashboard className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm">{dashboard.name}</span>
        {path ? (
          <span className="truncate text-xs text-muted-foreground">{path}</span>
        ) : (
          <span className="truncate text-xs text-muted-foreground">
            {dashboard.slug}
          </span>
        )}
      </Link>
      <DashboardMenu dashboard={dashboard} onAction={onAction} />
    </div>
  );
}

function SearchFolderRow({
  folder,
  path,
  onAction,
}: {
  folder: FolderSummary;
  path: string;
  onAction: (action: TreeAction) => void;
}) {
  return (
    <div className="group flex items-center gap-1 rounded-md py-1 pr-1 pl-1 hover:bg-accent/50">
      <div className="flex min-w-0 flex-1 items-center gap-2 py-0.5">
        <Folder className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{folder.name}</span>
        {path && (
          <span className="truncate text-xs text-muted-foreground">{path}</span>
        )}
      </div>
      <FolderMenu folder={folder} onAction={onAction} />
    </div>
  );
}

function KebabTrigger() {
  return (
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 group-hover:opacity-100 data-popup-open:opacity-100"
        />
      }
    >
      <EllipsisVertical />
    </DropdownMenuTrigger>
  );
}

function FolderMenu({
  folder,
  onAction,
}: {
  folder: FolderSummary;
  onAction: (action: TreeAction) => void;
}) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <KebabTrigger />
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() =>
            navigate({ to: "/dashboards/new", search: { folder: folder.id } })
          }
        >
          <Plus />
          New dashboard
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onAction({ type: "create-subfolder", folder })}
        >
          <FolderPlus />
          New subfolder
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onAction({ type: "rename-folder", folder })}
        >
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onAction({ type: "move-folder", folder })}
        >
          <FolderInput />
          Move
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onAction({ type: "delete-folder", folder })}
        >
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DashboardMenu({
  dashboard,
  onAction,
}: {
  dashboard: DashboardSummary;
  onAction: (action: TreeAction) => void;
}) {
  return (
    <DropdownMenu>
      <KebabTrigger />
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => onAction({ type: "rename-dashboard", dashboard })}
        >
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onAction({ type: "move-dashboard", dashboard })}
        >
          <FolderInput />
          Move to folder
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onAction({ type: "delete-dashboard", dashboard })}
        >
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

Notes for the implementer:
- `create-subfolder` is delegated to the parent (`onCreateSubfolder`) because the index page owns the create-folder NameDialog + `useCreateFolder` mutation (Task 8) — one create dialog handles both root and subfolder creation.
- The `/dashboards/new` navigation with `search: { folder }` only typechecks after Task 10 adds the search param to the route. If implementing tasks in order, typecheck for THIS task will fail on that line — acceptable; either add a `// @ts-expect-error removed in Task 10` or implement Task 10's route change first. Prefer doing Task 10's `new.tsx` `validateSearch` change as part of this task if the typecheck complains, and note it in the commit.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @everr/app typecheck`
Expected: clean, except possibly the `search: { folder }` issue described above — resolve per the note.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/dashboards/dashboard-tree.tsx
git commit -m "feat(dashboards): add folder tree component with management actions"
```

---

### Task 8: Index page rewrite

**Files:**
- Modify: `packages/app/src/routes/_authenticated/_dashboard/dashboards/index.tsx`

- [ ] **Step 1: Replace the card grid with the tree**

Replace the file's contents with:

```tsx
import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FolderPlus, LayoutDashboard, Plus, SearchIcon } from "lucide-react";
import { useState } from "react";
import { DashboardTree } from "@/components/dashboards/dashboard-tree";
import { NameDialog } from "@/components/dashboards/name-dialog";
import {
  dashboardListOptions,
  folderListOptions,
  useCreateFolder,
} from "@/data/dashboards/options";

export const Route = createFileRoute("/_authenticated/_dashboard/dashboards/")({
  staticData: { breadcrumb: "Dashboards" },
  head: () => ({
    meta: [{ title: "Everr - Dashboards" }],
  }),
  component: DashboardsIndexPage,
});

function DashboardsIndexPage() {
  const { data: dashboards, isLoading: dashboardsLoading } = useQuery(
    dashboardListOptions(),
  );
  const { data: folders, isLoading: foldersLoading } = useQuery(
    folderListOptions(),
  );
  const [search, setSearch] = useState("");
  // null = dialog closed; "root" sentinel = create at root; uuid = subfolder
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const createFolder = useCreateFolder();

  const isLoading = dashboardsLoading || foldersLoading;
  const isEmpty =
    !isLoading && (dashboards?.length ?? 0) === 0 && (folders?.length ?? 0) === 0;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Dashboards</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreateParentId("root")}
          >
            <FolderPlus data-icon="inline-start" />
            New Folder
          </Button>
          <Button size="sm" render={<Link to="/dashboards/new" />}>
            <Plus data-icon="inline-start" />
            New Dashboard
          </Button>
        </div>
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

      {isEmpty && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <LayoutDashboard className="size-10" />
          <p className="text-sm">No dashboards yet</p>
          <Button
            variant="outline"
            size="sm"
            render={<Link to="/dashboards/new" />}
          >
            <Plus data-icon="inline-start" />
            Create your first dashboard
          </Button>
        </div>
      )}

      {!isLoading && !isEmpty && (
        <DashboardTree
          folders={folders ?? []}
          dashboards={dashboards ?? []}
          search={search}
          onCreateSubfolder={(parentId) => setCreateParentId(parentId)}
        />
      )}

      <NameDialog
        open={createParentId !== null}
        onOpenChange={(open) => {
          if (!open) setCreateParentId(null);
        }}
        title={createParentId === "root" ? "New folder" : "New subfolder"}
        confirmLabel="Create"
        isPending={createFolder.isPending}
        onConfirm={(name) => {
          createFolder.mutate(
            {
              name,
              parentId: createParentId === "root" ? undefined : (createParentId ?? undefined),
            },
            { onSuccess: () => setCreateParentId(null) },
          );
        }}
      />
    </div>
  );
}
```

Note: `listFolders` returns `parentId: string | null` and `listDashboards` returns `folderId: string | null` — these match `FolderSummary`/`DashboardSummary` structurally. If TypeScript complains about the inferred server-fn types, map them explicitly.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @everr/app typecheck`
Expected: clean (modulo the Task 7/10 search-param note).

- [ ] **Step 3: Verify in the browser**

Start: `pnpm --filter @everr/app dev`
- Visit `/dashboards`: existing dashboards render as root-level rows.
- "New Folder" → create "Production". It appears as a collapsed folder row.
- Kebab on "Production" → "New subfolder" → create "API"; expand to see it.
- Kebab → Rename: rename "API" to "API v2" and confirm it updates.
- Search for a dashboard name: flat results with paths; clear search restores the tree.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/routes/_authenticated/_dashboard/dashboards/index.tsx
git commit -m "feat(dashboards): replace index card grid with folder tree"
```

---

### Task 9: Dashboard page toolbar kebab + folder picker in save dialog

**Files:**
- Modify: `packages/app/src/components/dashboards/dashboard-grid.tsx`

- [ ] **Step 1: Add imports**

Add to the existing imports in `dashboard-grid.tsx`:

```tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  EllipsisVertical,
  FolderInput,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import {
  dashboardListOptions,
  folderListOptions,
  useDeleteDashboard,
  useMoveDashboard,
  useRenameDashboard,
  useSaveDashboard,
} from "@/data/dashboards/options";
import { DeleteDashboardDialog } from "./delete-dashboard-dialog";
import { FolderList, FolderPickerDialog } from "./folder-picker";
import { NameDialog } from "./name-dialog";
```

(Merge with the existing `lucide-react` and `options` imports rather than duplicating them. `useNavigate` is already imported.)

- [ ] **Step 2: Add props, state, and mutations**

Update the props interface and add state inside `DashboardGrid`:

```tsx
interface DashboardGridProps {
  isNew?: boolean;
  defaultFolderId?: string | null;
}

export function DashboardGrid({ isNew, defaultFolderId }: DashboardGridProps) {
```

After the existing `const [saveName, setSaveName] = useState("");` add:

```tsx
  const [saveFolderId, setSaveFolderId] = useState<string | null>(
    defaultFolderId ?? null,
  );
  const [manageAction, setManageAction] = useState<
    "rename" | "move" | "delete" | null
  >(null);

  const router = useRouter();
  const renameMutation = useRenameDashboard();
  const moveMutation = useMoveDashboard();
  const deleteMutation = useDeleteDashboard();

  const { data: folders } = useQuery(folderListOptions());
  const { data: dashboardList } = useQuery(dashboardListOptions());
  const currentFolderId =
    dashboardList?.find((d) => d.slug === dashboard?.metadata.name)?.folderId ??
    null;
```

Note: `dashboard` is declared above this block (`useDashboardStore((s) => s.dashboard)`), so the order works.

- [ ] **Step 3: Pass `folderId` on first save**

In `handleConfirmSave`, change the mutate call to include the picked folder:

```tsx
    saveMutation.mutate(
      { slug, spec, folderId: saveFolderId ?? undefined },
      {
        onSuccess: (data) => {
          setShowSaveDialog(false);
          navigate({
            to: "/dashboards/$dashboardId",
            params: { dashboardId: data.slug },
          });
        },
      },
    );
```

Add `saveFolderId` to the `useCallback` dependency array of `handleConfirmSave`.

- [ ] **Step 4: Add the kebab menu to the toolbar**

In the toolbar JSX, after the Edit button (`{isEditing ? "Done" : "Edit"}</Button>`), add:

```tsx
        {!isNew && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" />}
            >
              <EllipsisVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setManageAction("rename")}>
                <Pencil />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setManageAction("move")}>
                <FolderInput />
                Move to folder
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setManageAction("delete")}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
```

- [ ] **Step 5: Add the management dialogs**

Before the closing `</div>` of the component (after the existing save `Dialog`), add:

```tsx
      <NameDialog
        open={manageAction === "rename"}
        onOpenChange={(open) => {
          if (!open) setManageAction(null);
        }}
        title="Rename dashboard"
        initialName={dashboard.spec.display?.name ?? ""}
        confirmLabel="Rename"
        isPending={renameMutation.isPending}
        onConfirm={(name) => {
          renameMutation.mutate(
            { slug: dashboard.metadata.name, name },
            {
              onSuccess: () => {
                setDashboard({
                  ...dashboard,
                  spec: {
                    ...dashboard.spec,
                    display: { ...dashboard.spec.display, name },
                  },
                });
                void router.invalidate();
                setManageAction(null);
              },
            },
          );
        }}
      />

      <FolderPickerDialog
        open={manageAction === "move"}
        onOpenChange={(open) => {
          if (!open) setManageAction(null);
        }}
        title="Move dashboard"
        folders={folders ?? []}
        initialFolderId={currentFolderId}
        isPending={moveMutation.isPending}
        onConfirm={(folderId) => {
          moveMutation.mutate(
            { slug: dashboard.metadata.name, folderId },
            { onSuccess: () => setManageAction(null) },
          );
        }}
      />

      <DeleteDashboardDialog
        open={manageAction === "delete"}
        onOpenChange={(open) => {
          if (!open) setManageAction(null);
        }}
        name={dashboard.spec.display?.name ?? dashboard.metadata.name}
        isPending={deleteMutation.isPending}
        onConfirm={() => {
          deleteMutation.mutate(dashboard.metadata.name, {
            onSuccess: () => {
              setManageAction(null);
              navigate({ to: "/dashboards" });
            },
          });
        }}
      />
```

`router.invalidate()` re-runs the route loader so the breadcrumb (which reads `loaderData.name`) picks up the new name. The store update keeps a later Save from writing the old name back.

- [ ] **Step 6: Add the folder picker to the save dialog**

In the save `Dialog`, after the name `<Input … />`'s wrapping `<div className="flex flex-col gap-2">…</div>`, add a folder section:

```tsx
          <div className="flex flex-col gap-2">
            <Label>Folder</Label>
            <FolderList
              folders={folders ?? []}
              value={saveFolderId}
              onChange={setSaveFolderId}
            />
          </div>
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @everr/app typecheck`
Expected: clean.

- [ ] **Step 8: Verify in the browser**

- Open a saved dashboard → kebab appears next to Edit.
- Rename: breadcrumb updates, URL unchanged. Reload to confirm persistence.
- Move to folder: pick a folder; `/dashboards` shows it inside that folder.
- Save the dashboard again (Edit → Save) and confirm it STAYS in its folder (regression check for the `saveDashboard` fix).
- Delete: confirm → lands on `/dashboards`, row gone.

- [ ] **Step 9: Commit**

```bash
git add packages/app/src/components/dashboards/dashboard-grid.tsx
git commit -m "feat(dashboards): add rename/move/delete to dashboard toolbar and folder picker to save dialog"
```

---

### Task 10: `?folder` search param on the new-dashboard route

**Files:**
- Modify: `packages/app/src/routes/_authenticated/_dashboard/dashboards/new.tsx`

- [ ] **Step 1: Validate the search param and thread it through**

Replace the file's contents with:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import * as z from "zod";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import type { Dashboard } from "@/data/dashboards/schema";

const EMPTY_DASHBOARD: Dashboard = {
  kind: "Dashboard",
  metadata: { name: "new" },
  spec: {
    display: { name: "New Dashboard" },
    panels: {},
    layouts: [{ kind: "Grid", spec: { items: [] } }],
  },
};

const NewDashboardSearchSchema = z.object({
  folder: z.string().uuid().optional(),
});

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboards/new",
)({
  validateSearch: NewDashboardSearchSchema,
  staticData: { breadcrumb: "New Dashboard" },
  head: () => ({
    meta: [{ title: "Everr - New Dashboard" }],
  }),
  component: NewDashboardPage,
});

function NewDashboardPage() {
  const { folder } = Route.useSearch();
  const dashboard = useDashboardStore((s) => s.dashboard);
  const setDashboard = useDashboardStore((s) => s.setDashboard);
  const setEditing = useDashboardStore((s) => s.setEditing);

  useEffect(() => {
    if (!dashboard || dashboard.metadata.name !== "new") {
      setDashboard(EMPTY_DASHBOARD);
    }
    setEditing(true);
  }, [dashboard, setDashboard, setEditing]);

  return <DashboardGrid isNew defaultFolderId={folder ?? null} />;
}
```

The parent `_dashboard` route validates `from`/`to` with a zod schema passed directly to `validateSearch` — same pattern here.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @everr/app typecheck`
Expected: clean — including the `navigate({ to: "/dashboards/new", search: { folder } })` call from Task 7 (remove any temporary `@ts-expect-error` added there).

- [ ] **Step 3: Verify in the browser**

- From a folder's kebab → "New dashboard" → URL is `/dashboards/new?folder=<uuid>`.
- Add a panel, Save → the save dialog's folder list has that folder pre-selected.
- Save → dashboard appears inside that folder on `/dashboards`.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/routes/_authenticated/_dashboard/dashboards/new.tsx packages/app/src/routeTree.gen.ts packages/app/src/components/dashboards/dashboard-tree.tsx
git commit -m "feat(dashboards): support creating dashboards inside a folder"
```

(`routeTree.gen.ts` is regenerated by the dev server / vite plugin; include it if it changed.)

---

### Task 11: Full verification

- [ ] **Step 1: Run the whole app test suite**

Run: `pnpm --filter @everr/app test:ci`
Expected: PASS (tree tests + pre-existing convert tests).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @everr/app typecheck`
Expected: clean.

- [ ] **Step 3: Browser walkthrough (spec verification list)**

With `pnpm --filter @everr/app dev` running:

1. Create a folder at root, a subfolder inside it, and a dashboard inside the subfolder (folder kebab → New dashboard → picker pre-selected).
2. Expand/collapse folders; confirm ordering (folders first, alphabetical, dashboards after).
3. Search: matches show flat with folder paths; clearing restores the tree.
4. Rename a folder; rename a dashboard from the list AND from the dashboard toolbar; dashboard URL unchanged, breadcrumb updated.
5. Move a dashboard between folders and back to root. Move a folder into another folder; confirm the picker disables the moved folder's own subtree. Save an existing dashboard and confirm its folder assignment survives.
6. Delete a dashboard from the list kebab and another from the dashboard toolbar.
7. Delete a non-empty folder choosing "Move contents to root" (contents reappear at root), then another choosing "Delete everything" (contents gone). Confirm counts shown in the dialog.
8. Attempt to create two same-named folders under the same parent → error toast (unique constraint), no crash.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(dashboards): address issues found during folder management verification"
```

(Only if fixes were needed.)
