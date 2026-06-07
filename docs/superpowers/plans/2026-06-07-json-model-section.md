# Settings JSON Model Section + User-Chosen Slugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a JSON section to the dashboard settings page that shows the full Perses model (`{ kind, metadata, spec }`) with draft-based Apply edits, and make `metadata.name` (the URL slug) user-editable — staged in the store, persisted atomically through the existing save/create server fns, with collision errors and post-save URL navigation.

**Architecture:** A `sourceSlug` field in the zustand store records the DB-row identity (null = unsaved draft), decoupling it from the user-editable `metadata.name`; both route bootstrap guards switch to it. `saveDashboard` gains `newSlug` (rename + spec write in one UPDATE), `createDashboard` gains optional `slug`. The CodeMirror mount is extracted from `SqlEditor` into a generic `CodeEditor`; a `JsonEditor` wrapper and a `SettingsJsonSection` (draft + Apply, mirroring the variables form) plug into the settings page as a third nav entry.

**Tech Stack:** React 19, TanStack Start/Router, TanStack Query, zustand, zod v4 (`import * as z` in data files), CodeMirror 6 (+ new `@codemirror/lang-json` dep), drizzle/Postgres, vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-json-model-section-design.md` — read it first. Prior specs for context: `2026-06-06-dashboard-settings-page-design.md`, `2026-06-07-settings-entry-point-design.md`.

---

## Working conventions (read first)

- Workspace: `/Users/gio/workspace/everr-labs/everr`, branch `gio/perses-dashboard-route`. All paths relative to repo root.
- Tests: `cd packages/app && pnpm exec vitest run <path>`. Typecheck: `cd packages/app && pnpm typecheck`. Desktop-app guard: `cd packages/desktop-app && pnpm exec tsc --noEmit`.
- NEVER use `tsx` to run anything. Never mention Claude/AI in commits, PRs, or comments. Conventional commits, NO co-author lines.
- lefthook pre-commit runs biome (may rewrite files — re-stage and retry) and `fallow dead-code` (test files count as consumers; every new export needs a consumer in its commit). `packages/app/src/data/dashboards/schema.ts` exports are fully ignored by fallow.
- Do NOT generate Drizzle migrations (no DB schema change — the slug column and its unique index `dashboards_tenant_slug_uq` already exist).
- `src/routeTree.gen.ts` is plugin-generated — never edit by hand. No route files change in this plan, so it should not change at all.
- Suite baseline: **559 passing** (`cd packages/app && pnpm exec vitest run`). Expected end state: **578** (559 + 10 schema + 5 server + 4 store tests).
- The dev server usually runs on :5173 — leave it alone until Task 9 (browser verification).

---

### Task 1: Slug + model schemas (TDD)

**Files:**
- Modify: `packages/app/src/data/dashboards/schema.ts`
- Test (create): `packages/app/src/data/dashboards/schema.test.ts`

`dashboardSlugSchema` (strict: lowercase/digits/hyphens, no edge hyphens, ≤200, `"new"` reserved) and `dashboardModelSchema` (full Perses document; `metadata.name` deliberately LOOSE — see spec §1: an untouched document echoing the current slug or the `"new"` draft sentinel must always re-validate). `saveDashboardInput` gains `newSlug`, `createDashboardInput` gains `slug`.

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/data/dashboards/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  dashboardModelSchema,
  dashboardSlugSchema,
} from "./schema";

const validSpec = {
  panels: {},
  layouts: [{ kind: "Grid", spec: { items: [] } }],
};

describe("dashboardSlugSchema", () => {
  it("accepts valid slugs", () => {
    expect(dashboardSlugSchema.safeParse("abc").success).toBe(true);
    expect(dashboardSlugSchema.safeParse("a").success).toBe(true);
    expect(dashboardSlugSchema.safeParse("my-dash-2").success).toBe(true);
    expect(dashboardSlugSchema.safeParse("xfmezad9iug4").success).toBe(true);
  });

  it("rejects uppercase and invalid characters", () => {
    expect(dashboardSlugSchema.safeParse("MyDash").success).toBe(false);
    expect(dashboardSlugSchema.safeParse("my_dash").success).toBe(false);
    expect(dashboardSlugSchema.safeParse("my dash").success).toBe(false);
  });

  it("rejects leading and trailing hyphens", () => {
    expect(dashboardSlugSchema.safeParse("-abc").success).toBe(false);
    expect(dashboardSlugSchema.safeParse("abc-").success).toBe(false);
  });

  it('rejects the reserved slug "new"', () => {
    expect(dashboardSlugSchema.safeParse("new").success).toBe(false);
  });

  it("rejects empty and over-long slugs", () => {
    expect(dashboardSlugSchema.safeParse("").success).toBe(false);
    expect(dashboardSlugSchema.safeParse("a".repeat(201)).success).toBe(false);
    expect(dashboardSlugSchema.safeParse("a".repeat(200)).success).toBe(true);
  });
});

describe("dashboardModelSchema", () => {
  it("accepts a valid full model", () => {
    const result = dashboardModelSchema.safeParse({
      kind: "Dashboard",
      metadata: { name: "my-dash" },
      spec: validSpec,
    });
    expect(result.success).toBe(true);
  });

  it('accepts the loose draft sentinel name "new" (slug strictness is applied separately)', () => {
    const result = dashboardModelSchema.safeParse({
      kind: "Dashboard",
      metadata: { name: "new" },
      spec: validSpec,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a wrong kind", () => {
    const result = dashboardModelSchema.safeParse({
      kind: "Playlist",
      metadata: { name: "my-dash" },
      spec: validSpec,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing metadata name", () => {
    const result = dashboardModelSchema.safeParse({
      kind: "Dashboard",
      metadata: {},
      spec: validSpec,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid spec", () => {
    const result = dashboardModelSchema.safeParse({
      kind: "Dashboard",
      metadata: { name: "my-dash" },
      spec: { layouts: [] }, // missing required `panels`
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/schema.test.ts`
Expected: FAIL — `dashboardModelSchema`/`dashboardSlugSchema` are not exported.

- [ ] **Step 3: Add the schemas**

In `packages/app/src/data/dashboards/schema.ts` (zod is already imported as `import * as z`):

1. Immediately AFTER the `Dashboard` interface (which ends around line 161, `}`), add:

```ts
export const dashboardSlugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    "Slug must use lowercase letters, digits and hyphens, and cannot start or end with a hyphen",
  )
  .refine((s) => s !== "new", { message: '"new" is a reserved slug' });

/**
 * The full Perses dashboard document, as edited in the settings JSON section.
 * `metadata.name` is loose on purpose: an untouched document echoes the
 * current slug (or the "new" draft sentinel) and must always re-validate.
 * Changed names are checked against `dashboardSlugSchema` by the caller;
 * the server inputs below enforce it authoritatively.
 */
export const dashboardModelSchema = z.object({
  kind: z.literal("Dashboard"),
  metadata: z.object({ name: z.string().min(1).max(200) }),
  spec: dashboardSpecSchema,
});
```

2. In `saveDashboardInput`, add `newSlug` after `slug`:

```ts
export const saveDashboardInput = z.object({
  slug: z.string().min(1).max(200),
  newSlug: dashboardSlugSchema.optional(),
  spec: dashboardSpecSchema,
  folderId: z.string().uuid().optional(),
});
```

3. In `createDashboardInput`, add `slug`:

```ts
export const createDashboardInput = z.object({
  slug: dashboardSlugSchema.optional(),
  spec: dashboardSpecSchema,
  folderId: z.string().uuid().optional(),
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/schema.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `cd packages/app && pnpm typecheck`
Expected: clean.

```bash
git add packages/app/src/data/dashboards/schema.ts packages/app/src/data/dashboards/schema.test.ts
git commit -m "feat(dashboards): add slug and full-model schemas"
```

---

### Task 2: Server — rename-on-save and chosen slug at creation (TDD)

**Files:**
- Modify: `packages/app/src/data/dashboards/server.ts`
- Modify: `packages/app/src/data/dashboards/server.test.ts`

`saveDashboard`: when `newSlug` differs from `slug`, the single `db.update` also writes the new slug (atomic with the spec write); a unique violation maps to a friendly error. `createDashboard`: when `slug` is provided, use it WITHOUT the retry loop (retries are for generated slugs only); collision maps to the same friendly error.

The test file mocks the db with `selectImpl`/`updateImpl`/`insertImpl` (see its top) and has a `uniqueViolation()` helper defined around line 231 — the new tests reuse them.

- [ ] **Step 1: Write the failing tests**

In `packages/app/src/data/dashboards/server.test.ts`, add AFTER the existing `describe("createDashboard – slug collision retry", ...)` block (note: `uniqueViolation()` is defined above it; these tests must come after that definition):

```ts
describe("saveDashboard – newSlug rename", () => {
  it("renames and saves the spec in one update", async () => {
    selectImpl = () => [{ id: "dash-id" }];
    updateImpl = () => undefined;

    const result = await saveDashboard({
      data: {
        slug: "old-slug",
        newSlug: "new-slug",
        spec: { panels: {}, layouts: [] },
      },
    });

    expect(result).toEqual({ slug: "new-slug" });
    expect(mockedDb.update).toHaveBeenCalledTimes(1);
  });

  it("maps a slug collision to a friendly error", async () => {
    selectImpl = () => [{ id: "dash-id" }];
    updateImpl = () => {
      throw uniqueViolation();
    };

    await expect(
      saveDashboard({
        data: {
          slug: "old-slug",
          newSlug: "taken-slug",
          spec: { panels: {}, layouts: [] },
        },
      }),
    ).rejects.toThrow('A dashboard with slug "taken-slug" already exists');
  });

  it("returns the original slug when newSlug is absent", async () => {
    selectImpl = () => [{ id: "dash-id" }];
    updateImpl = () => undefined;

    const result = await saveDashboard({
      data: { slug: "same-slug", spec: { panels: {}, layouts: [] } },
    });

    expect(result).toEqual({ slug: "same-slug" });
  });
});

describe("createDashboard – chosen slug", () => {
  it("uses the chosen slug instead of generating", async () => {
    insertImpl = () => [{ slug: "my-dash" }];

    const result = await createDashboard({
      data: { slug: "my-dash", spec: { panels: {}, layouts: [] } },
    });

    expect(result).toEqual({ slug: "my-dash" });
    expect(mockedDb.insert).toHaveBeenCalledTimes(1);
  });

  it("maps a chosen-slug collision to a friendly error without retrying", async () => {
    let attempts = 0;
    insertImpl = () => {
      attempts++;
      throw uniqueViolation();
    };

    await expect(
      createDashboard({
        data: { slug: "taken-slug", spec: { panels: {}, layouts: [] } },
      }),
    ).rejects.toThrow('A dashboard with slug "taken-slug" already exists');
    expect(attempts).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts`
Expected: the 5 new tests FAIL (input validation rejects the unknown `newSlug`/`slug` keys, or behavior mismatch); the existing tests still PASS.

- [ ] **Step 3: Implement**

In `packages/app/src/data/dashboards/server.ts`:

1. **`saveDashboard`** — replace the handler body (it currently destructures `{ slug, spec, folderId }`, selects `existing`, throws not-found, then runs one `db.update`):

```ts
export const saveDashboard = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(saveDashboardInput)
  .handler(async ({ data: { slug, newSlug, spec, folderId }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    const [existing] = await db
      .select({ id: dashboards.id })
      .from(dashboards)
      .where(
        and(eq(dashboards.organizationId, orgId), eq(dashboards.slug, slug)),
      )
      .limit(1);

    if (!existing) {
      throw new Error(`Dashboard "${slug}" not found`);
    }

    const finalSlug = newSlug && newSlug !== slug ? newSlug : slug;

    try {
      await db
        .update(dashboards)
        .set({
          spec: spec as DashboardSpec,
          updatedAt: new Date(),
          ...(finalSlug !== slug ? { slug: finalSlug } : {}),
          ...(folderId !== undefined ? { folderId } : {}),
        })
        .where(eq(dashboards.id, existing.id));
    } catch (error) {
      // Slug rename collided with an existing dashboard in this org.
      if (finalSlug !== slug && isUniqueViolation(error)) {
        throw new Error(`A dashboard with slug "${finalSlug}" already exists`);
      }
      throw error;
    }

    return { slug: finalSlug };
  });
```

2. **`createDashboard`** — replace the handler body (the generated-slug retry loop stays verbatim for the no-slug path):

```ts
export const createDashboard = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(createDashboardInput)
  .handler(async ({ data: { spec, folderId, slug }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    // User-chosen slug: no retry — a collision is the user's to resolve.
    if (slug) {
      try {
        const [row] = await db
          .insert(dashboards)
          .values({
            organizationId: orgId,
            slug,
            spec: spec as DashboardSpec,
            folderId: folderId ?? null,
          })
          .returning({ slug: dashboards.slug });

        if (!row) {
          throw new Error("Failed to create dashboard");
        }

        return { slug: row.slug };
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new Error(`A dashboard with slug "${slug}" already exists`);
        }
        throw error;
      }
    }

    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const [row] = await db
          .insert(dashboards)
          .values({
            organizationId: orgId,
            slug: generateDashboardSlug(),
            spec: spec as DashboardSpec,
            folderId: folderId ?? null,
          })
          .returning({ slug: dashboards.slug });

        if (!row) {
          throw new Error("Failed to create dashboard");
        }

        return { slug: row.slug };
      } catch (error) {
        // Astronomically unlikely slug collision — regenerate and retry.
        if (!isUniqueViolation(error) || attempt === MAX_ATTEMPTS) {
          throw error;
        }
      }
    }
    throw new Error("Failed to create dashboard");
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts`
Expected: PASS (all, including the 5 new).

- [ ] **Step 5: Typecheck and commit**

Run: `cd packages/app && pnpm typecheck`
Expected: clean.

```bash
git add packages/app/src/data/dashboards/server.ts packages/app/src/data/dashboards/server.test.ts
git commit -m "feat(dashboards): support slug rename on save and chosen slug at creation"
```

---

### Task 3: Store — `sourceSlug` identity (TDD)

**Files:**
- Modify: `packages/app/src/data/dashboards/dashboard-store.ts`
- Modify: `packages/app/src/data/dashboards/dashboard-store.test.ts`

`sourceSlug: string | null` = the slug the dashboard was loaded from (DB row identity); `null` = unsaved draft. `setDashboard(d, opts?)` sets it; `markSaved` re-syncs it to the current `metadata.name` (after a successful rename the staged slug becomes the identity); `reset` clears it.

- [ ] **Step 1: Write the failing tests**

In `packages/app/src/data/dashboards/dashboard-store.test.ts`:

1. Update the `beforeEach` to also reset the new field:

```ts
beforeEach(() => {
  useDashboardStore.setState({
    dashboard: null,
    isEditing: false,
    isDirty: false,
    sourceSlug: null,
  });
});
```

2. Add at the end of the file:

```ts
describe("sourceSlug identity tracking", () => {
  it("setDashboard records the loaded slug as sourceSlug", () => {
    useDashboardStore.getState().setDashboard(makeDashboard("dash-1"));
    expect(useDashboardStore.getState().sourceSlug).toBe("dash-1");
  });

  it("setDashboard with draft: true leaves sourceSlug null", () => {
    useDashboardStore
      .getState()
      .setDashboard(makeDashboard("new"), { draft: true });
    expect(useDashboardStore.getState().sourceSlug).toBeNull();
  });

  it("markSaved re-syncs sourceSlug to the current metadata name", () => {
    useDashboardStore.getState().setDashboard(makeDashboard("dash-1"));
    const current = useDashboardStore.getState().dashboard;
    if (!current) throw new Error("dashboard missing");
    useDashboardStore.getState().patchDashboard({
      ...current,
      metadata: { name: "renamed" },
    });
    expect(useDashboardStore.getState().sourceSlug).toBe("dash-1");

    useDashboardStore.getState().markSaved();
    expect(useDashboardStore.getState().sourceSlug).toBe("renamed");
    expect(useDashboardStore.getState().isDirty).toBe(false);
  });

  it("reset clears sourceSlug", () => {
    useDashboardStore.getState().setDashboard(makeDashboard("dash-1"));
    useDashboardStore.getState().reset();
    expect(useDashboardStore.getState().sourceSlug).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/dashboard-store.test.ts`
Expected: the 4 new tests FAIL (`sourceSlug` undefined / typecheck error in setState).

- [ ] **Step 3: Implement**

In `packages/app/src/data/dashboards/dashboard-store.ts`:

1. In the `DashboardState` interface, after `isDirty: boolean;` add:

```ts
  /** Slug the dashboard was loaded from (DB row identity); null = unsaved draft. */
  sourceSlug: string | null;
```

and change the `setDashboard` signature line to:

```ts
  /** Load/replace the dashboard from server data; resets dirty state. */
  setDashboard: (d: Dashboard, opts?: { draft?: boolean }) => void;
```

2. In the store implementation, after `isDirty: false,` add `sourceSlug: null,` and replace the three actions:

```ts
  setDashboard: (dashboard, opts) =>
    set({
      dashboard,
      isDirty: false,
      sourceSlug: opts?.draft ? null : dashboard.metadata.name,
    }),
```

```ts
  markSaved: () =>
    set((state) => ({
      isDirty: false,
      sourceSlug: state.dashboard?.metadata.name ?? null,
    })),
```

```ts
  reset: () =>
    set({ dashboard: null, isEditing: false, isDirty: false, sourceSlug: null }),
```

(`patchDashboard`, `updateDisplayName`, `updatePanel`, `updateLayout`, `updateVariables` are untouched — they must NOT modify `sourceSlug`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/dashboard-store.test.ts`
Expected: PASS (all, including the 4 new).

- [ ] **Step 5: Typecheck and commit**

Run: `cd packages/app && pnpm typecheck`
Expected: clean (callers pass — `opts` is optional).

```bash
git add packages/app/src/data/dashboards/dashboard-store.ts packages/app/src/data/dashboards/dashboard-store.test.ts
git commit -m "feat(dashboards): track the loaded slug separately from the editable metadata name"
```

---

### Task 4: Route bootstrap guards use `sourceSlug`

**Files:**
- Modify: `packages/app/src/routes/_authenticated/_dashboard/dashboards/new.tsx`
- Modify: `packages/app/src/routes/_authenticated/_dashboard/dashboards/$dashboardId.tsx`

Both routes currently use `metadata.name` sentinels that would clobber a draft/dirty store once names become editable. They switch to `sourceSlug`.

- [ ] **Step 1: Update `new.tsx`**

In `packages/app/src/routes/_authenticated/_dashboard/dashboards/new.tsx`, inside `NewDashboardPage`, add the selector and change the effect (currently `if (!dashboard || dashboard.metadata.name !== "new") { setDashboard(EMPTY_DASHBOARD); }`):

```tsx
function NewDashboardPage() {
  const { folder } = Route.useSearch();
  const dashboard = useDashboardStore((s) => s.dashboard);
  const sourceSlug = useDashboardStore((s) => s.sourceSlug);
  const setDashboard = useDashboardStore((s) => s.setDashboard);
  const setEditing = useDashboardStore((s) => s.setEditing);

  useEffect(() => {
    // Re-seed when the store is empty or holds a SAVED dashboard
    // (sourceSlug !== null). A draft survives — even with an edited
    // metadata.name (the slug is user-editable via the settings JSON section).
    if (!dashboard || sourceSlug !== null) {
      setDashboard(EMPTY_DASHBOARD, { draft: true });
    }
    setEditing(true);
  }, [dashboard, sourceSlug, setDashboard, setEditing]);

  return <DashboardGrid isNew defaultFolderId={folder ?? null} />;
}
```

- [ ] **Step 2: Update `$dashboardId.tsx`**

In `packages/app/src/routes/_authenticated/_dashboard/dashboards/$dashboardId.tsx`, inside `DashboardPage`, the bootstrap effect currently reads:

```tsx
  useEffect(() => {
    if (!dashboard || dashboard.metadata.name !== data.metadata.name) {
      setDashboard(data);
    }
  }, [data, dashboard, setDashboard]);
```

Replace with (add the `sourceSlug` selector next to the existing store selectors, and note `dashboardId` is already available from `Route.useParams()`):

```tsx
  const sourceSlug = useDashboardStore((s) => s.sourceSlug);
```

```tsx
  useEffect(() => {
    // Compare row identity (sourceSlug), not metadata.name: a staged slug
    // rename makes the names diverge, and replacing the store here would
    // silently discard every dirty change.
    if (!dashboard || sourceSlug !== dashboardId) {
      setDashboard(data);
    }
  }, [data, dashboard, sourceSlug, dashboardId, setDashboard]);
```

- [ ] **Step 3: Typecheck, run the suite, commit**

Run: `cd packages/app && pnpm typecheck && pnpm exec vitest run`
Expected: clean, 578 tests PASS.

```bash
git add packages/app/src/routes/_authenticated/_dashboard/dashboards/new.tsx "packages/app/src/routes/_authenticated/_dashboard/dashboards/\$dashboardId.tsx"
git commit -m "refactor(dashboards): key route store bootstrap on the loaded slug"
```

---

### Task 5: Save flows — staged rename + chosen slug wiring

**Files:**
- Modify: `packages/app/src/data/dashboards/options.ts` (hook input types)
- Modify: `packages/app/src/components/dashboards/dashboard-settings-page.tsx` (Save derives `newSlug`, navigates after rename, inline error)
- Modify: `packages/app/src/components/dashboards/dashboard-grid.tsx` (same for the grid Save; create passes the chosen slug; row-identity call sites switch to `sourceSlug`)

After this task nothing stages a rename yet (the JSON section arrives in Task 7), so behavior is unchanged in practice — but the plumbing is complete and the suite must stay green.

- [ ] **Step 1: Extend the mutation hooks**

In `packages/app/src/data/dashboards/options.ts`:

1. `useSaveDashboard` — add `newSlug` to the vars type and REMOVE the hook-level error toast (the settings page shows save errors inline; the grid re-adds its own toast per-call in Step 3):

```ts
export function useSaveDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      slug: string;
      newSlug?: string;
      spec: Parameters<typeof saveDashboard>[0]["data"]["spec"];
      folderId?: string;
    }) => saveDashboard({ data: vars }),
    onSuccess: () => {
      // Prefix-matches every dashboard query, including the old slug's
      // dashboardOptions after a rename.
      void qc.invalidateQueries({ queryKey: dashboardsQueryKey });
      toast.success("Dashboard saved");
    },
  });
}
```

2. `useCreateDashboard` — add `slug` to the vars type (toasts unchanged; the create dialog already surfaces errors via the hook's error toast):

```ts
export function useCreateDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      slug?: string;
      spec: Parameters<typeof createDashboard>[0]["data"]["spec"];
      folderId?: string;
    }) => createDashboard({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardsQueryKey });
      toast.success("Dashboard created");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create");
    },
  });
}
```

- [ ] **Step 2: Settings page Save**

In `packages/app/src/components/dashboards/dashboard-settings-page.tsx`:

1. Add imports/selectors: `useNavigate` from `@tanstack/react-router` (extend the existing import line), and in the component body:

```ts
  const sourceSlug = useDashboardStore((s) => s.sourceSlug);
  const navigate = useNavigate();
```

2. Replace `handleSave` (currently `saveMutation.mutate({ slug: dashboard.metadata.name, spec: dashboard.spec }, { onSuccess: () => markSaved() })`):

```ts
  const handleSave = () => {
    if (!sourceSlug) return; // Save is hidden for drafts (isNew)
    const newSlug =
      dashboard.metadata.name !== sourceSlug
        ? dashboard.metadata.name
        : undefined;
    saveMutation.mutate(
      { slug: sourceSlug, spec: dashboard.spec, newSlug },
      {
        onSuccess: ({ slug }) => {
          markSaved();
          if (slug !== dashboardId) {
            navigate({
              to: "/dashboards/$dashboardId/settings",
              params: { dashboardId: slug },
              replace: true,
              search: keepVars,
            });
          }
        },
      },
    );
  };
```

(`keepVars` is declared just above `handleSave` in the current code — keep that order so it is in scope.)

3. Inline save error — in the header JSX, the Save button block currently reads:

```tsx
        {!isNew && (
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            <Save data-icon="inline-start" />
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        )}
```

Replace with:

```tsx
        {!isNew && (
          <div className="flex items-center gap-2">
            {saveMutation.isError && (
              <p className="max-w-md truncate text-xs text-destructive">
                {saveMutation.error instanceof Error
                  ? saveMutation.error.message
                  : "Failed to save"}
              </p>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saveMutation.isPending}
            >
              <Save data-icon="inline-start" />
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
```

- [ ] **Step 3: Dashboard grid Save, create, and row-identity call sites**

In `packages/app/src/components/dashboards/dashboard-grid.tsx`:

1. Add `import { toast } from "sonner";` (alphabetical position among the non-`@` imports) and the selector next to the other store selectors:

```ts
  const sourceSlug = useDashboardStore((s) => s.sourceSlug);
```

2. Replace `handleSave`:

```ts
  const handleSave = useCallback(() => {
    if (!dashboard) return;
    if (isNew) {
      setSaveName(dashboard.spec.display?.name ?? "");
      setShowSaveDialog(true);
      return;
    }
    if (!sourceSlug) return;
    const newSlug =
      dashboard.metadata.name !== sourceSlug
        ? dashboard.metadata.name
        : undefined;
    saveMutation.mutate(
      { slug: sourceSlug, spec: dashboard.spec, newSlug },
      {
        onSuccess: ({ slug }) => {
          markSaved();
          if (newSlug) {
            navigate({
              to: "/dashboards/$dashboardId",
              params: { dashboardId: slug },
              replace: true,
              search: (prev: {
                vars?: Record<string, string | string[]>;
              }) => ({
                ...prev,
                vars: prev.vars,
              }),
            });
          }
        },
        onError: (error) => {
          toast.error(
            error instanceof Error ? error.message : "Failed to save",
          );
        },
      },
    );
  }, [dashboard, saveMutation, isNew, markSaved, sourceSlug, navigate]);
```

3. In `handleConfirmSave`, the `createMutation.mutate` call gains the chosen slug (`"new"` is the untouched draft sentinel → server generates):

```ts
    createMutation.mutate(
      {
        slug:
          dashboard.metadata.name === "new"
            ? undefined
            : dashboard.metadata.name,
        spec,
        folderId: saveFolderId ?? undefined,
      },
      {
        onSuccess: (data) => {
          markSaved();
          setShowSaveDialog(false);
          navigate({
            to: "/dashboards/$dashboardId",
            params: { dashboardId: data.slug },
          });
        },
      },
    );
```

4. Switch the remaining ROW-IDENTITY uses of `metadata.name` to `sourceSlug` (run `grep -n "metadata.name" packages/app/src/components/dashboards/dashboard-grid.tsx` and update each — as of this plan they are):
   - `currentFolderId` lookup: `dashboardList?.find((d) => d.slug === dashboard?.metadata.name)` → `d.slug === sourceSlug`.
   - `dashboardPathPrefix`: `` `/dashboards/${isNew ? "new" : (dashboard?.metadata.name ?? "")}` `` → `` `/dashboards/${isNew ? "new" : (sourceSlug ?? "")}` `` (the blocker must exempt the URL's slug, which is `sourceSlug` even while a rename is staged).
   - The kebab mutations and dialogs operating on the saved row — `renameMutation.mutate({ slug: ... })`, `moveMutation.mutate({ slug: ... })`, and the `<DeleteDashboardDialog slug={...} ...>` prop — each replace `dashboard.metadata.name` with `sourceSlug` (add a `?? ""` or early guard only if the existing code shape requires it; the kebab renders only for saved dashboards where `sourceSlug` is set).
   - The Settings toolbar button's `params: { dashboardId: isNew ? "new" : dashboard.metadata.name }` → `isNew ? "new" : (sourceSlug ?? "")`.
   - Do NOT change uses of `metadata.name` that mean the EDITABLE name (there should be none left in this file after the above — verify with the grep).

- [ ] **Step 4: Typecheck, run the suite, commit**

Run: `cd packages/app && pnpm typecheck && pnpm exec vitest run`
Expected: clean, 578 tests PASS.

```bash
git add packages/app/src/data/dashboards/options.ts packages/app/src/components/dashboards/dashboard-settings-page.tsx packages/app/src/components/dashboards/dashboard-grid.tsx
git commit -m "feat(dashboards): persist staged slug changes through the save and create flows"
```

---

### Task 6: Extract generic `CodeEditor` from `SqlEditor`

**Files:**
- Create: `packages/app/src/components/dashboards/code-editor.tsx`
- Modify: `packages/app/src/components/dashboards/sql-editor.tsx`
- Modify: `packages/app/package.json` (new dependency)

The CodeMirror mount pattern (refs, updateListener, theme, placeholder) moves into `CodeEditor` with a `language: Extension` prop. `SqlEditor` keeps the ClickHouse dialect and becomes a thin wrapper — no behavior change for the panel editor or the variable form. The JSON language dep is added now so Task 7 can use it.

- [ ] **Step 1: Add the dependency**

Run: `cd packages/app && pnpm add @codemirror/lang-json`
Expected: `@codemirror/lang-json` appears in `packages/app/package.json` dependencies (v6.x).

- [ ] **Step 2: Create `code-editor.tsx`**

Create `packages/app/src/components/dashboards/code-editor.tsx`. Everything except the dialect is MOVED from `sql-editor.tsx` (same theme object, same mount-once pattern):

```tsx
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  placeholder as cmPlaceholder,
  EditorView,
  keymap,
} from "@codemirror/view";
import { cn } from "@everr/ui/lib/utils";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

interface CodeEditorProps {
  /** CodeMirror language extension (e.g. sql({...}) or json()). */
  language: Extension;
  /** Initial document. The editor mounts once; parents remount via `key` to reset. */
  defaultValue: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Sizing is left to the parent (e.g. `min-h-0 flex-1` or a fixed height). */
  className?: string;
}

export function CodeEditor({
  language,
  defaultValue,
  onChange,
  placeholder = "",
  className,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleChange = useRef(
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    }),
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: defaultValue,
      extensions: [
        basicSetup,
        language,
        oneDark,
        handleChange.current,
        cmPlaceholder(placeholder),
        EditorView.theme({
          "&": { height: "100%", fontSize: "12px" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { fontFamily: "var(--font-mono, monospace)" },
        }),
        keymap.of([]),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only create editor once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "border-border overflow-hidden rounded-md border",
        className,
      )}
    />
  );
}
```

- [ ] **Step 3: Rewrite `sql-editor.tsx` as a thin wrapper**

Replace the entire contents of `packages/app/src/components/dashboards/sql-editor.tsx` with the following — the `clickhouseDialect` definition (the three long `keywords`/`types`/`builtin` strings) is MOVED VERBATIM from the current file; do not retype the strings:

```tsx
import { SQLDialect, sql } from "@codemirror/lang-sql";
import { CodeEditor } from "./code-editor";

const clickhouseDialect = SQLDialect.define({
  keywords: "<KEEP VERBATIM — current sql-editor.tsx lines 14-15>",
  types: "<KEEP VERBATIM — current sql-editor.tsx lines 16-17>",
  builtin: "<KEEP VERBATIM — current sql-editor.tsx lines 18-19>",
  operatorChars: "+-*/<>=!~&|^",
  identifierQuotes: '`"',
  specialVar: "@",
});

interface SqlEditorProps {
  /** Initial document. The editor mounts once; parents remount via `key` to reset. */
  defaultValue: string;
  onChange: (sql: string) => void;
  placeholder?: string;
  /** Sizing is left to the parent (e.g. `min-h-0 flex-1` or a fixed height). */
  className?: string;
}

export function SqlEditor({
  defaultValue,
  onChange,
  placeholder = "SELECT * FROM ...",
  className,
}: SqlEditorProps) {
  return (
    <CodeEditor
      language={sql({ dialect: clickhouseDialect })}
      defaultValue={defaultValue}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
    />
  );
}
```

(The `<KEEP VERBATIM ...>` markers mean: keep the exact existing string literals in place — only the surrounding code changes.)

- [ ] **Step 4: Typecheck, run the suite, commit**

Run: `cd packages/app && pnpm typecheck && pnpm exec vitest run`
Expected: clean, 578 tests PASS. (fallow: `CodeEditor` is consumed by `SqlEditor` in the same commit.)

```bash
git add packages/app/package.json pnpm-lock.yaml packages/app/src/components/dashboards/code-editor.tsx packages/app/src/components/dashboards/sql-editor.tsx
git commit -m "refactor(dashboards): extract a generic CodeEditor from the SQL editor"
```

---

### Task 7: `JsonEditor` + JSON settings section + page wiring (ONE commit)

**Files:**
- Create: `packages/app/src/components/dashboards/json-editor.tsx`
- Create: `packages/app/src/components/dashboards/settings-json-section.tsx`
- Modify: `packages/app/src/components/dashboards/settings-variables-section.tsx` (extend `SettingsSelection`)
- Modify: `packages/app/src/components/dashboards/dashboard-settings-page.tsx` (nav entry + render)

One commit: the section consumes `JsonEditor`, the page consumes the section — fallow needs the whole chain together.

- [ ] **Step 1: Create `json-editor.tsx`**

```tsx
import { json } from "@codemirror/lang-json";
import { CodeEditor } from "./code-editor";

interface JsonEditorProps {
  /** Initial document. The editor mounts once; parents remount via `key` to reset. */
  defaultValue: string;
  onChange: (value: string) => void;
  /** Sizing is left to the parent (e.g. `min-h-0 flex-1` or a fixed height). */
  className?: string;
}

export function JsonEditor({
  defaultValue,
  onChange,
  className,
}: JsonEditorProps) {
  return (
    <CodeEditor
      language={json()}
      defaultValue={defaultValue}
      onChange={onChange}
      className={className}
    />
  );
}
```

- [ ] **Step 2: Extend `SettingsSelection`**

In `packages/app/src/components/dashboards/settings-variables-section.tsx`, change the two type definitions at the top:

```ts
export type SettingsSelection =
  | { kind: "general" }
  | { kind: "variable"; index: number }
  | { kind: "new-variable" }
  | { kind: "json" };

type VariableSelection = Exclude<
  SettingsSelection,
  { kind: "general" } | { kind: "json" }
>;
```

(Nothing else in this file changes — the component still only receives variable selections.)

- [ ] **Step 3: Create `settings-json-section.tsx`**

```tsx
import { Button } from "@everr/ui/components/button";
import { useEffect, useState } from "react";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import {
  dashboardModelSchema,
  dashboardSlugSchema,
} from "@/data/dashboards/schema";
import { JsonEditor } from "./json-editor";

interface SettingsJsonSectionProps {
  /** Reports whether the editor has un-applied edits (for the page's guard). */
  onUnappliedChange: (hasUnapplied: boolean) => void;
}

export function SettingsJsonSection({
  onUnappliedChange,
}: SettingsJsonSectionProps) {
  const dashboard = useDashboardStore((s) => s.dashboard);
  const sourceSlug = useDashboardStore((s) => s.sourceSlug);
  const patchDashboard = useDashboardStore((s) => s.patchDashboard);

  // Baseline = the last serialized/applied document. The editor remounts
  // (key={revision}) after Apply so it shows the committed, normalized JSON.
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(dashboard, null, 2),
  );
  const [text, setText] = useState(baseline);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const hasUnapplied = text !== baseline;
  useEffect(() => {
    onUnappliedChange(hasUnapplied);
  }, [hasUnapplied, onUnappliedChange]);
  // Clear the flag when this section unmounts (selection switched / page left).
  useEffect(() => () => onUnappliedChange(false), [onUnappliedChange]);

  if (!dashboard) return null;

  const handleApply = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const result = dashboardModelSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      setError(
        issue
          ? `${issue.path.join(".") || "document"}: ${issue.message}`
          : "Invalid dashboard document",
      );
      return;
    }
    // A CHANGED name must be a valid (non-reserved) slug; the untouched
    // current identity — existing slug or the "new" draft sentinel — passes.
    const currentName = sourceSlug ?? "new";
    if (result.data.metadata.name !== currentName) {
      const slugCheck = dashboardSlugSchema.safeParse(result.data.metadata.name);
      if (!slugCheck.success) {
        setError(
          `metadata.name: ${slugCheck.error.issues[0]?.message ?? "invalid slug"}`,
        );
        return;
      }
    }
    patchDashboard(result.data);
    const next = JSON.stringify(result.data, null, 2);
    setBaseline(next);
    setText(next);
    setRevision((r) => r + 1);
    setError(null);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
      <p className="text-xs text-muted-foreground">
        The full Perses dashboard model. Changing{" "}
        <code className="font-mono">metadata.name</code> renames the dashboard
        URL slug when you Save.
      </p>
      <JsonEditor
        key={revision}
        defaultValue={text}
        onChange={(value) => {
          setError(null);
          setText(value);
        }}
        className="min-h-0 flex-1"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div>
        <Button onClick={handleApply}>Apply</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the page**

In `packages/app/src/components/dashboards/dashboard-settings-page.tsx`:

1. Add the import:

```ts
import { SettingsJsonSection } from "./settings-json-section";
```

2. In the sections nav `<ul>`, after the Variables `<li>`, add:

```tsx
            <li>
              <button
                type="button"
                onClick={() => requestSelection({ kind: "json" })}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                  selection.kind === "json" && "bg-accent",
                )}
              >
                JSON
              </button>
            </li>
```

3. The Variables nav button's highlight condition currently reads `selection.kind !== "general" && "bg-accent"` — with the new section that would also light up for JSON. Change it to:

```tsx
                  (selection.kind === "variable" ||
                    selection.kind === "new-variable") &&
                    "bg-accent",
```

4. The section render currently reads:

```tsx
        {selection.kind === "general" ? (
          <SettingsGeneralSection />
        ) : (
          <SettingsVariablesSection
            selection={selection}
            onSelect={requestSelection}
            onForceSelect={applySelection}
            onUnappliedChange={setHasUnapplied}
          />
        )}
```

Replace with:

```tsx
        {selection.kind === "general" ? (
          <SettingsGeneralSection />
        ) : selection.kind === "json" ? (
          <SettingsJsonSection onUnappliedChange={setHasUnapplied} />
        ) : (
          <SettingsVariablesSection
            selection={selection}
            onSelect={requestSelection}
            onForceSelect={applySelection}
            onUnappliedChange={setHasUnapplied}
          />
        )}
```

(The confirm-discard guard needs NO change: `requestSelection` already prompts when `selection.kind !== "general" && hasUnapplied`, which covers `"json"`.)

- [ ] **Step 5: Typecheck, run the suite, commit**

Run: `cd packages/app && pnpm typecheck && pnpm exec vitest run`
Expected: clean, 578 tests PASS.

```bash
git add packages/app/src/components/dashboards/json-editor.tsx packages/app/src/components/dashboards/settings-json-section.tsx packages/app/src/components/dashboards/settings-variables-section.tsx packages/app/src/components/dashboards/dashboard-settings-page.tsx
git commit -m "feat(dashboards): add a JSON model section to the settings page"
```

---

### Task 8: Docs + full verification

**Files:**
- Modify: `DASHBOARD_FEATURES.md` (repo root)

- [ ] **Step 1: Update `DASHBOARD_FEATURES.md`**

Read the file first; find the lines by content (numbers may have drifted):

1. After the "Variables section on the settings page" bullet (currently line ~62), add a new bullet:

```markdown
- ✅ JSON section on the settings page: full Perses model (`{ kind, metadata, spec }`) in a CodeMirror JSON editor; Apply validates (JSON + zod model schema + slug rules for changed names) and stages to the store; `metadata.name` edits rename the URL slug on Save (atomic with the spec write, collision → inline error); new dashboards can pick their slug before first save
```

2. In the unit-tests bullet (currently line ~73), append before the end of the list: `, slug/model schemas (` `` `schema.test.ts` `` `), slug rename/chosen-slug server flows (` `` `server.test.ts` `` `)`.

- [ ] **Step 2: Full verification battery**

```bash
cd packages/app && pnpm exec vitest run            # expected: 578 passed
cd packages/app && pnpm typecheck                  # expected: clean
cd packages/desktop-app && pnpm exec tsc --noEmit  # expected: clean
git status --short                                 # expected: only DASHBOARD_FEATURES.md modified
```

- [ ] **Step 3: Commit**

```bash
git add DASHBOARD_FEATURES.md
git commit -m "docs: document the settings json model section"
```

---

### Task 9: Browser verification

No code changes. Dev server runs on :5173 — REUSE it (a second instance fails auth with "Invalid origin"); never restart it. Drive with `playwright-core` from `/tmp/settings-verify` (already set up: `npm install playwright-core` done, auth `storageState` at `/tmp/settings-verify/state.json`, saved dashboard "Verify Dash" slug `xfmezad9iug4` with an `env` static-list variable). Launch via the cached headless shell: `ls ~/Library/Caches/ms-playwright/ | grep chromium_headless_shell`, then use the `headless_shell` binary inside that directory. Plain `.mjs` scripts run with `node` — NEVER `tsx`. `waitUntil: "load"`, never `networkidle`. CodeMirror: click `.cm-content`, then use the keyboard; to replace the whole document use select-all (`Meta+a`) then type. If the auth state is stale (redirects to `/auth`), sign up a throwaway account and re-save the state. Beware: a sidebar account button may contain the substring "settings" — scope selectors to the relevant container.

Verify each item; record pass/fail notes:

- [ ] Settings page (edit mode → Settings button) shows a third nav entry "JSON"; clicking it shows the full model (`kind`, `metadata.name` = slug, `spec`) pretty-printed in a CodeMirror editor.
- [ ] Bad JSON (e.g. delete a closing brace) → Apply → inline `Invalid JSON: ...` error, no toast. Wrong kind (`"kind": "Playlist"`) → inline error mentioning the path/kind. Invalid changed slug (`"metadata": {"name": "Bad Slug!"}`) → inline `metadata.name: ...` error.
- [ ] Spec edit via JSON (e.g. change `spec.display.name`) → Apply (marks dirty) → Save → revisiting the dashboard shows the new display name.
- [ ] Slug rename: change `metadata.name` to a fresh slug (e.g. `verify-renamed`) → Apply → Save → settings URL becomes `/dashboards/verify-renamed/settings`; back arrow lands on `/dashboards/verify-renamed`; the dashboard loads.
- [ ] Staged rename survives back-navigation: Apply a slug change WITHOUT saving, go back to the dashboard (old URL) → store still dirty, edits intact (no silent reload); Save from the dashboard toolbar also lands on the new slug URL.
- [ ] Collision: rename to a slug that exists (create a second dashboard first) → Save → inline error next to the settings Save button (`...already exists`); the page stays put, store stays dirty.
- [ ] Confirm-discard: edit JSON without Apply, click General → "Discard changes to this variable?"-style dialog appears (same guard); Stay keeps the text, Discard switches.
- [ ] New dashboard: `/dashboards/new` → Settings → JSON shows `"name": "new"`; Apply with ONLY spec edits succeeds (sentinel name passes). Change name to `my-chosen-slug` → Apply → back → Save (create dialog) → after create the URL is `/dashboards/my-chosen-slug`. Draft survives the round-trip to `/dashboards/new` (no re-seed).
- [ ] New dashboard slug collision: repeat with an existing slug → create dialog stays open and an error toast (`...already exists`) appears.
- [ ] Variables and General sections still work (spot check: variable list renders, duration change marks dirty).

---

## Self-review checklist (already run against the spec)

- Spec §1 schemas → Task 1. §2 server → Task 2. §3 store + guards → Tasks 3–4. §4 JSON section → Task 7. §5 editor extraction → Task 6 (+ JsonEditor in Task 7). §6 save flows + blocker prefix + invalidation → Task 5 (invalidation: the hook's `["dashboards"]` prefix invalidation already covers the old slug's `dashboardOptions` — react-query prefix matching). §7 out of scope → nothing added. §8 testing → Tasks 1–3 (unit), 8 (battery), 9 (browser).
- Fallow ordering: schema tests consume schema (and schema.ts is fallow-ignored); CodeEditor consumed by SqlEditor (Task 6, one commit); JsonEditor → section → page chain in Task 7's single commit.
- Type consistency: `sourceSlug: string | null` everywhere; `setDashboard(d, opts?: { draft?: boolean })`; save vars `{ slug, newSlug?, spec, folderId? }`; create vars `{ slug?, spec, folderId? }`; `SettingsSelection` gains `{ kind: "json" }` in `settings-variables-section.tsx` and the page imports it from there.
- Behavior note for reviewers: Task 5 lands inert (nothing stages a rename until Task 7) — suite must stay green at every commit.
