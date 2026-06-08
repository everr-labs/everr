# Dashboard v1 Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the missing v1 dashboard features: StatChart renderer, unsaved-changes protection, panel-level query error states, per-dashboard `duration`/`refreshInterval` defaults, friendly duplicate-folder errors, slug-collision retry, and a11y labels.

**Architecture:** All work lives in `packages/app` (plus one shared prop on `panel-shell.tsx`). Pure logic (stat calculations, threshold resolution, search-param seeding) goes in small testable modules; UI components follow the existing visualization-registry and dialog patterns; server fns follow the existing `createAuthenticatedServerFn` + drizzle patterns with the established fluent db mock for tests.

**Tech Stack:** React 19, TanStack Router 1.169 (`useBlocker`), TanStack Query, zustand, recharts via `@everr/ui` ChartContainer, zod, drizzle, vitest.

**Spec:** `docs/superpowers/specs/2026-06-05-dashboard-v1-polish-design.md`

---

## Working conventions (read first)

- Workspace: `/Users/gio/workspace/everr-labs/everr`, branch `gio/dashboard-v1-polish`. All paths below are relative to repo root.
- Run app-package commands from `packages/app`, e.g. `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts`.
- Typecheck: `cd packages/app && pnpm typecheck` (this is `tsc --noEmit`).
- NEVER use `tsx` to run anything. Never mention Claude/AI in commits.
- Commit messages: conventional commits (`feat(dashboards): …`, `fix(dashboards): …`, `test(dashboards): …`). NO co-author lines, NO AI attribution.
- The pre-commit hook (lefthook) runs format/lint checks — if it rewrites files, re-stage and re-commit.

---

### Task 1: Dirty tracking in the dashboard store (TDD)

**Files:**
- Test (create): `packages/app/src/data/dashboards/dashboard-store.test.ts`
- Modify: `packages/app/src/data/dashboards/dashboard-store.ts`

The store currently has `dashboard`, `isEditing`, `setDashboard`, `setEditing`, `updatePanel`, `updateLayout`. Add `isDirty` plus actions: any spec mutation sets it, load/reset clears it.

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/data/dashboards/dashboard-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useDashboardStore } from "./dashboard-store";
import type { Dashboard } from "./schema";

const makeDashboard = (name = "dash-1"): Dashboard => ({
  kind: "Dashboard",
  metadata: { name },
  spec: {
    display: { name: "My Dashboard" },
    panels: {},
    layouts: [{ kind: "Grid", spec: { items: [] } }],
  },
});

const panel = {
  kind: "Panel" as const,
  spec: { display: { name: "P" }, plugin: { kind: "TimeSeriesChart", spec: {} } },
};

beforeEach(() => {
  useDashboardStore.setState({ dashboard: null, isEditing: false, isDirty: false });
});

describe("dashboard store dirty tracking", () => {
  it("starts clean and setDashboard resets dirty", () => {
    useDashboardStore.getState().setDashboard(makeDashboard());
    expect(useDashboardStore.getState().isDirty).toBe(false);

    useDashboardStore.getState().updatePanel("panel1", panel);
    expect(useDashboardStore.getState().isDirty).toBe(true);

    useDashboardStore.getState().setDashboard(makeDashboard("dash-2"));
    expect(useDashboardStore.getState().isDirty).toBe(false);
  });

  it("updatePanel marks dirty", () => {
    useDashboardStore.getState().setDashboard(makeDashboard());
    useDashboardStore.getState().updatePanel("panel1", panel);
    expect(useDashboardStore.getState().isDirty).toBe(true);
  });

  it("updateLayout marks dirty", () => {
    useDashboardStore.getState().setDashboard(makeDashboard());
    useDashboardStore.getState().updateLayout([{ kind: "Grid", spec: { items: [] } }]);
    expect(useDashboardStore.getState().isDirty).toBe(true);
  });

  it("patchDashboard replaces the dashboard and marks dirty", () => {
    useDashboardStore.getState().setDashboard(makeDashboard());
    useDashboardStore.getState().patchDashboard(makeDashboard());
    expect(useDashboardStore.getState().isDirty).toBe(true);
  });

  it("markSaved clears dirty", () => {
    useDashboardStore.getState().setDashboard(makeDashboard());
    useDashboardStore.getState().updatePanel("panel1", panel);
    useDashboardStore.getState().markSaved();
    expect(useDashboardStore.getState().isDirty).toBe(false);
  });

  it("updateDisplayName preserves the current dirty state", () => {
    useDashboardStore.getState().setDashboard(makeDashboard());
    useDashboardStore.getState().updateDisplayName("Renamed");
    expect(useDashboardStore.getState().isDirty).toBe(false);
    expect(useDashboardStore.getState().dashboard?.spec.display?.name).toBe("Renamed");

    useDashboardStore.getState().updatePanel("panel1", panel);
    useDashboardStore.getState().updateDisplayName("Renamed again");
    expect(useDashboardStore.getState().isDirty).toBe(true);
  });

  it("reset clears everything", () => {
    useDashboardStore.getState().setDashboard(makeDashboard());
    useDashboardStore.getState().setEditing(true);
    useDashboardStore.getState().updatePanel("panel1", panel);
    useDashboardStore.getState().reset();
    const s = useDashboardStore.getState();
    expect(s.dashboard).toBeNull();
    expect(s.isEditing).toBe(false);
    expect(s.isDirty).toBe(false);
  });

  it("noop actions when no dashboard loaded do not mark dirty", () => {
    useDashboardStore.getState().updatePanel("panel1", panel);
    useDashboardStore.getState().updateLayout([]);
    expect(useDashboardStore.getState().isDirty).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/dashboard-store.test.ts`
Expected: FAIL — `isDirty`, `patchDashboard`, `markSaved`, `updateDisplayName`, `reset` do not exist.

- [ ] **Step 3: Implement the store changes**

Replace the contents of `packages/app/src/data/dashboards/dashboard-store.ts` with:

```ts
import { create } from "zustand";
import type { Dashboard, GridLayout, Panel } from "./schema";

interface DashboardState {
  dashboard: Dashboard | null;
  isEditing: boolean;
  isDirty: boolean;
  /** Load/replace the dashboard from server data; resets dirty state. */
  setDashboard: (d: Dashboard) => void;
  /** Replace the dashboard with a locally edited version; marks dirty. */
  patchDashboard: (d: Dashboard) => void;
  /** Update the display name without touching dirty state (rename saves server-side). */
  updateDisplayName: (name: string) => void;
  /** Clear dirty state after a successful save. */
  markSaved: () => void;
  /** Clear the store entirely (used when discarding unsaved changes). */
  reset: () => void;
  setEditing: (editing: boolean) => void;
  updatePanel: (key: string, panel: Panel) => void;
  updateLayout: (layouts: GridLayout[]) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  dashboard: null,
  isEditing: false,
  isDirty: false,

  setDashboard: (dashboard) => set({ dashboard, isDirty: false }),
  patchDashboard: (dashboard) => set({ dashboard, isDirty: true }),
  updateDisplayName: (name) =>
    set((state) => {
      if (!state.dashboard) return state;
      return {
        dashboard: {
          ...state.dashboard,
          spec: {
            ...state.dashboard.spec,
            display: { ...state.dashboard.spec.display, name },
          },
        },
      };
    }),
  markSaved: () => set({ isDirty: false }),
  reset: () => set({ dashboard: null, isEditing: false, isDirty: false }),
  setEditing: (isEditing) => set({ isEditing }),

  updatePanel: (key, panel) =>
    set((state) => {
      if (!state.dashboard) return state;
      return {
        isDirty: true,
        dashboard: {
          ...state.dashboard,
          spec: {
            ...state.dashboard.spec,
            panels: { ...state.dashboard.spec.panels, [key]: panel },
          },
        },
      };
    }),

  updateLayout: (layouts) =>
    set((state) => {
      if (!state.dashboard) return state;
      return {
        isDirty: true,
        dashboard: {
          ...state.dashboard,
          spec: { ...state.dashboard.spec, layouts },
        },
      };
    }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/dashboard-store.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `cd packages/app && pnpm typecheck`
Expected: clean. Then:

```bash
git add packages/app/src/data/dashboards/dashboard-store.ts packages/app/src/data/dashboards/dashboard-store.test.ts
git commit -m "feat(dashboards): track unsaved-changes dirty state in dashboard store"
```

---

### Task 2: Unsaved-changes blocker in DashboardGrid

**Files:**
- Modify: `packages/app/src/components/dashboards/dashboard-grid.tsx`

Wire `isDirty` to TanStack Router's `useBlocker` (which also handles `beforeunload` via `enableBeforeUnload`). Confirm dialog uses the existing `AlertDialog` pattern (see `packages/app/src/components/dashboards/delete-dashboard-dialog.tsx` for reference). Also fix the two flows that bypass dirty tracking: `handleRemovePanel` (currently calls `setDashboard`, which now would CLEAR dirty — must use `patchDashboard`) and the rename `onSuccess` (currently calls `setDashboard` with the locally-edited dashboard — must use `updateDisplayName`).

The installed `useBlocker` API (`@tanstack/react-router` 1.169.2):

```ts
const blocker = useBlocker({
  shouldBlockFn: ({ next }) => boolean,   // next.pathname is the target path
  enableBeforeUnload: () => boolean,       // native beforeunload prompt
  withResolver: true,                      // returns { status, proceed, reset }
});
// blocker.status: "blocked" | "idle"; blocker.proceed() / blocker.reset()
```

- [ ] **Step 1: Update imports and add the blocker in `dashboard-grid.tsx`**

Change the router import (line 20) to include `useBlocker`:

```ts
import { useBlocker, useNavigate, useRouter } from "@tanstack/react-router";
```

Add the AlertDialog import after the existing `@everr/ui` imports:

```ts
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
```

Inside `DashboardGrid`, next to the other store selectors (around line 73–76), add:

```ts
const patchDashboard = useDashboardStore((s) => s.patchDashboard);
const updateDisplayName = useDashboardStore((s) => s.updateDisplayName);
const markSaved = useDashboardStore((s) => s.markSaved);
const resetStore = useDashboardStore((s) => s.reset);
```

After the `currentFolderId` computation (around line 105), add the blocker. Navigation to this dashboard's own panel editor must NOT block (it is part of editing):

```ts
const panelEditPrefix = `/dashboards/${isNew ? "new" : (dashboard?.metadata.name ?? "")}/panel/`;
const blocker = useBlocker({
  shouldBlockFn: ({ next }) => {
    if (!useDashboardStore.getState().isDirty) return false;
    return !next.pathname.startsWith(panelEditPrefix);
  },
  enableBeforeUnload: () => useDashboardStore.getState().isDirty,
  withResolver: true,
});
```

(Reading `isDirty` via `getState()` inside the callbacks avoids stale-closure issues; no dependency wiring needed.)

- [ ] **Step 2: Fix the flows that bypass dirty tracking**

In `handleRemovePanel` (line ~175–200): replace the `setDashboard({...})` call with `patchDashboard({...})` (same object argument, just the renamed action) and update the `useCallback` dependency array from `[dashboard, setDashboard]` to `[dashboard, patchDashboard]`.

In the rename `NameDialog` `onConfirm` `onSuccess` (line ~426–435): replace

```ts
setDashboard({
  ...dashboard,
  spec: {
    ...dashboard.spec,
    display: { ...dashboard.spec.display, name },
  },
});
```

with

```ts
updateDisplayName(name);
```

- [ ] **Step 3: Clear dirty on successful saves**

In `handleSave` (line ~243), pass an `onSuccess` callback:

```ts
saveMutation.mutate(
  { slug: dashboard.metadata.name, spec: dashboard.spec },
  { onSuccess: () => markSaved() },
);
```

In `handleConfirmSave` (line ~262), add `markSaved()` as the first line of the existing `onSuccess` (before `setShowSaveDialog(false)`), so the blocker does not fire on the post-create navigation.

Update the `useCallback` dependency arrays to include `markSaved`.

- [ ] **Step 4: Add the confirm dialog**

Before the closing `</div>` of the component's root element (after `<DeleteDashboardDialog …/>`), add:

```tsx
<AlertDialog
  open={blocker.status === "blocked"}
  onOpenChange={(open) => {
    if (!open) blocker.reset?.();
  }}
>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
      <AlertDialogDescription>
        You have unsaved changes on this dashboard. If you leave now, your
        changes will be discarded.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel onClick={() => blocker.reset?.()}>
        Stay
      </AlertDialogCancel>
      <AlertDialogAction
        variant="destructive"
        onClick={() => {
          resetStore();
          blocker.proceed?.();
        }}
      >
        Discard &amp; leave
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

`resetStore()` nulls the store so the route components re-load fresh data on the next visit (`$dashboardId.tsx` and `new.tsx` both `setDashboard` when the store is empty).

- [ ] **Step 5: Typecheck and run existing tests**

Run: `cd packages/app && pnpm typecheck && pnpm exec vitest run src/data/dashboards`
Expected: clean typecheck, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/components/dashboards/dashboard-grid.tsx
git commit -m "feat(dashboards): block navigation and tab close with unsaved changes"
```

---

### Task 3: Panel error states in the grid

**Files:**
- Modify: `packages/app/src/components/panel-shell.tsx`
- Modify: `packages/app/src/components/dashboards/dashboard-panel.tsx`

`PanelShell` already renders an error state but dashboard panels never set it (`status = sql && isPending ? "pending" : "success"`). Wire `useQuery`'s error through, plus an optional message line.

- [ ] **Step 1: Add `errorMessage` to PanelShell**

In `packages/app/src/components/panel-shell.tsx`, extend the props interface:

```ts
export interface PanelShellProps extends PanelChromeProps {
  status: "pending" | "error" | "success";
  errorMessage?: string;
  children?: ReactNode;
}
```

Add `errorMessage` to the destructured props in the `PanelShell` function signature (after `status`). In the non-stat error branch (the `div` containing `<AlertCircle …/>` and "Failed to load data", lines ~111–116), render the message under the existing text:

```tsx
<div className="flex h-[300px] flex-col items-center justify-center gap-2 text-muted-foreground">
  <AlertCircle className="size-8" />
  <p className="text-sm">Failed to load data</p>
  {errorMessage && (
    <p className="max-w-full truncate px-4 text-xs" title={errorMessage}>
      {errorMessage}
    </p>
  )}
</div>
```

- [ ] **Step 2: Surface query errors in DashboardPanel**

In `packages/app/src/components/dashboards/dashboard-panel.tsx`:

Replace (line ~42–44):

```ts
const { data: queryResult, isPending } = useQuery(
  panelQueryOptions(sql, from, to),
);
```

with:

```ts
const {
  data: queryResult,
  isPending,
  isError,
  error,
} = useQuery(panelQueryOptions(sql, from, to));
```

Replace (line ~62):

```ts
const status = sql && isPending ? "pending" : "success";
```

with:

```ts
const status = !sql
  ? "success"
  : isError
    ? "error"
    : isPending
      ? "pending"
      : "success";
```

And pass the message on the `<PanelShell …>` element (next to `status={status}`):

```tsx
errorMessage={
  isError
    ? error instanceof Error
      ? error.message
      : String(error)
    : undefined
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `cd packages/app && pnpm typecheck`
Expected: clean.

```bash
git add packages/app/src/components/panel-shell.tsx packages/app/src/components/dashboards/dashboard-panel.tsx
git commit -m "feat(dashboards): render panel query errors in the grid"
```

---

### Task 4: Panel error states in the editor preview

**Files:**
- Modify: `packages/app/src/components/dashboards/panel-preview.tsx`
- Modify: `packages/app/src/components/dashboards/panel-edit-page.tsx`

Today the editor preview silently keeps stale data on auto-query errors and only toasts on manual Run Query errors. Render the error state in the preview region for both.

- [ ] **Step 1: Pass error state through PanelPreview**

In `packages/app/src/components/dashboards/panel-preview.tsx`, add `errorMessage` to the props interface and destructuring:

```ts
interface PanelPreviewProps {
  panel: Panel;
  panelKey: string;
  data?: QueryResultRow[];
  errorMessage?: string;
  timeRange?: ResolvedTimeRange;
  onTimeRangeChange?: (range: ResolvedTimeRange) => void;
}
```

and change the `PanelShell` usage:

```tsx
<PanelShell
  title={display.name ?? panelKey}
  description={display.description}
  status={errorMessage ? "error" : "success"}
  errorMessage={errorMessage}
  className="h-full"
  inset={getVisualizationInset(plugin.kind)}
>
```

- [ ] **Step 2: Track and pass errors in panel-edit-page.tsx**

In `packages/app/src/components/dashboards/panel-edit-page.tsx`:

Drop the now-unused `toast` import (line 12) — the error renders in the preview instead.

Change the auto query (line ~82) to capture errors:

```ts
const {
  data: autoResult,
  isError: autoIsError,
  error: autoError,
} = useQuery(panelQueryOptions(savedSql, from, to));
```

Add manual-error state next to `manualResult` (line ~84–87):

```ts
const [manualError, setManualError] = useState<string | null>(null);
```

Update `handleRunQuery` to set/clear it instead of toasting:

```ts
const handleRunQuery = useCallback(
  async (sql: string) => {
    setIsRunning(true);
    try {
      const result = await runPanelQuery({ data: { sql, from, to } });
      setManualResult(result.rows);
      setManualError(null);
      queryClient.setQueryData(
        panelQueryOptions(sql, from, to).queryKey,
        result,
      );
    } catch (error) {
      setManualError(error instanceof Error ? error.message : "Query failed");
    } finally {
      setIsRunning(false);
    }
  },
  [queryClient, from, to],
);
```

Compute the effective error after `queryResult` (line ~108) — a manual run outcome (result or error) supersedes the auto query:

```ts
const queryResult = manualResult ?? autoResult?.rows;
const queryErrorMessage =
  manualError ??
  (autoIsError && !manualResult
    ? autoError instanceof Error
      ? autoError.message
      : String(autoError)
    : undefined);
```

(Note `manualError ?? …` — null falls through to the auto error.) Then pass it to the preview (line ~179):

```tsx
<PanelPreview
  panel={draft}
  panelKey={panelKey}
  data={queryResult}
  errorMessage={queryErrorMessage ?? undefined}
  timeRange={{ from: fromDate, to: toDate }}
  onTimeRangeChange={handleTimeRangeChange}
/>
```

- [ ] **Step 3: Typecheck and commit**

Run: `cd packages/app && pnpm typecheck`
Expected: clean.

```bash
git add packages/app/src/components/dashboards/panel-preview.tsx packages/app/src/components/dashboards/panel-edit-page.tsx
git commit -m "feat(dashboards): show query errors in the panel editor preview"
```

---

### Task 5: Extract shared visualization data utils

**Files:**
- Create: `packages/app/src/components/dashboards/visualizations/data-utils.ts`
- Modify: `packages/app/src/components/dashboards/visualizations/time-series-chart/time-series-chart-visualization.tsx`

StatChart needs the same time/numeric column detection as TimeSeriesChart. Extract the three shared helpers verbatim.

- [ ] **Step 1: Create `data-utils.ts`**

Create `packages/app/src/components/dashboards/visualizations/data-utils.ts` with the three functions currently defined locally in `time-series-chart-visualization.tsx` (lines 40–56 and 104–111), exported:

```ts
import type { QueryResultRow } from "./index";

export function detectTimeKey(rows: QueryResultRow[]): string | undefined {
  const first = rows[0];
  if (!first) return undefined;

  const timePatterns =
    /^(time|timestamp|date|datetime|created_at|ts|period|bucket|interval)/i;
  for (const key of Object.keys(first)) {
    if (timePatterns.test(key)) return key;
  }
  return undefined;
}

export function getValueKeys(row: QueryResultRow, timeKey: string): string[] {
  return Object.keys(row).filter(
    (k) => k !== timeKey && typeof row[k] === "number",
  );
}

export function toTimestamp(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const ms = new Date(`${value.replace(" ", "T")}Z`).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}
```

- [ ] **Step 2: Use it from TimeSeriesChart**

In `time-series-chart-visualization.tsx`: delete the local `detectTimeKey`, `getValueKeys`, and `toTimestamp` function definitions and add the import:

```ts
import { detectTimeKey, getValueKeys, toTimestamp } from "../data-utils";
```

(`getGroupKeys`, `sanitizeKey`, `pivotByGroup` stay local — only TimeSeriesChart uses them.)

- [ ] **Step 3: Typecheck and commit**

Run: `cd packages/app && pnpm typecheck`
Expected: clean.

```bash
git add packages/app/src/components/dashboards/visualizations/data-utils.ts packages/app/src/components/dashboards/visualizations/time-series-chart/time-series-chart-visualization.tsx
git commit -m "refactor(dashboards): extract shared visualization data utils"
```

---

### Task 6: Stat calculations and threshold resolution (TDD)

**Files:**
- Test (create): `packages/app/src/components/dashboards/visualizations/stat-chart/stat-calculations.test.ts`
- Create: `packages/app/src/components/dashboards/visualizations/stat-chart/stat-calculations.ts`

Pure, fully-tested logic for the StatChart: reduce a numeric series via a calculation, resolve a threshold color, format the value.

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/components/dashboards/visualizations/stat-chart/stat-calculations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  calculate,
  formatStatValue,
  resolveThresholdColor,
} from "./stat-calculations";

describe("calculate", () => {
  const values = [4, 2, 8, 6];

  it("last", () => expect(calculate(values, "last")).toBe(6));
  it("first", () => expect(calculate(values, "first")).toBe(4));
  it("mean", () => expect(calculate(values, "mean")).toBe(5));
  it("min", () => expect(calculate(values, "min")).toBe(2));
  it("max", () => expect(calculate(values, "max")).toBe(8));
  it("sum", () => expect(calculate(values, "sum")).toBe(20));
  it("returns undefined for an empty series", () => {
    expect(calculate([], "last")).toBeUndefined();
  });
});

describe("resolveThresholdColor", () => {
  const thresholds = {
    mode: "absolute" as const,
    defaultColor: "#888888",
    steps: [
      { value: 50, color: "#eab308" },
      { value: 80, color: "#ef4444" },
    ],
  };

  it("returns undefined when no thresholds configured", () => {
    expect(resolveThresholdColor(10, undefined, 100)).toBeUndefined();
  });

  it("returns defaultColor below all steps", () => {
    expect(resolveThresholdColor(10, thresholds, 100)).toBe("#888888");
  });

  it("picks the highest crossed step (absolute mode)", () => {
    expect(resolveThresholdColor(60, thresholds, 100)).toBe("#eab308");
    expect(resolveThresholdColor(80, thresholds, 100)).toBe("#ef4444");
    expect(resolveThresholdColor(999, thresholds, 100)).toBe("#ef4444");
  });

  it("sorts steps before evaluating", () => {
    const unsorted = {
      ...thresholds,
      steps: [
        { value: 80, color: "#ef4444" },
        { value: 50, color: "#eab308" },
      ],
    };
    expect(resolveThresholdColor(60, unsorted, 100)).toBe("#eab308");
  });

  it("percent mode evaluates relative to the series max", () => {
    const pct = { ...thresholds, mode: "percent" as const };
    // value 30 of max 50 → 60% → crosses the 50 step
    expect(resolveThresholdColor(30, pct, 50)).toBe("#eab308");
    // value 45 of max 50 → 90% → crosses the 80 step
    expect(resolveThresholdColor(45, pct, 50)).toBe("#ef4444");
    // value 10 of max 50 → 20% → below all steps
    expect(resolveThresholdColor(10, pct, 50)).toBe("#888888");
  });

  it("percent mode with zero max falls back to defaultColor", () => {
    const pct = { ...thresholds, mode: "percent" as const };
    expect(resolveThresholdColor(0, pct, 0)).toBe("#888888");
  });
});

describe("formatStatValue", () => {
  it("limits to two fraction digits", () => {
    // compare against toLocaleString so the test is locale-independent
    expect(formatStatValue(3.14159)).toBe((3.14).toLocaleString());
  });
  it("groups thousands", () => {
    expect(formatStatValue(1234567)).toBe((1234567).toLocaleString());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/components/dashboards/visualizations/stat-chart/stat-calculations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `stat-calculations.ts`**

Create `packages/app/src/components/dashboards/visualizations/stat-chart/stat-calculations.ts`:

```ts
export type CalculationType = "last" | "first" | "mean" | "min" | "max" | "sum";

export const CALCULATIONS: ReadonlyArray<{
  value: CalculationType;
  label: string;
}> = [
  { value: "last", label: "Last" },
  { value: "first", label: "First" },
  { value: "mean", label: "Mean" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "sum", label: "Sum" },
] as const;

export function isCalculationType(value: unknown): value is CalculationType {
  return CALCULATIONS.some((c) => c.value === value);
}

export function calculate(
  values: number[],
  calculation: CalculationType,
): number | undefined {
  if (values.length === 0) return undefined;
  switch (calculation) {
    case "last":
      return values[values.length - 1];
    case "first":
      return values[0];
    case "mean":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "sum":
      return values.reduce((a, b) => a + b, 0);
  }
}

export interface ThresholdStep {
  value: number;
  color?: string;
}

export interface ThresholdsSpec {
  mode?: "absolute" | "percent";
  defaultColor?: string;
  steps?: ThresholdStep[];
}

export function resolveThresholdColor(
  value: number,
  thresholds: ThresholdsSpec | undefined,
  seriesMax: number,
): string | undefined {
  if (!thresholds) return undefined;
  const steps = [...(thresholds.steps ?? [])].sort((a, b) => a.value - b.value);
  const compare =
    thresholds.mode === "percent"
      ? seriesMax !== 0
        ? (value / seriesMax) * 100
        : 0
      : value;
  let color = thresholds.defaultColor;
  for (const step of steps) {
    if (compare >= step.value) color = step.color ?? color;
  }
  return color;
}

export function formatStatValue(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && pnpm exec vitest run src/components/dashboards/visualizations/stat-chart/stat-calculations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/dashboards/visualizations/stat-chart/
git commit -m "feat(dashboards): add stat calculation and threshold resolution logic"
```

---

### Task 7: StatChart visualization component + registration

**Files:**
- Create: `packages/app/src/components/dashboards/visualizations/stat-chart/stat-chart-visualization.tsx`
- Modify: `packages/app/src/components/dashboards/visualizations/index.tsx`

Big colored value + optional sparkline. The picker entry for `StatChart` already exists in `viz-options.tsx` — registering the component makes it live.

- [ ] **Step 1: Create the visualization component**

Create `packages/app/src/components/dashboards/visualizations/stat-chart/stat-chart-visualization.tsx`:

```tsx
import { ChartContainer } from "@everr/ui/components/chart";
import { Hash } from "lucide-react";
import { useMemo } from "react";
import { Area, AreaChart } from "recharts";
import { detectTimeKey, getValueKeys, toTimestamp } from "../data-utils";
import type { QueryResultRow, VisualizationProps } from "../index";
import {
  calculate,
  formatStatValue,
  isCalculationType,
  resolveThresholdColor,
  type ThresholdsSpec,
} from "./stat-calculations";

const SPARKLINE_COLOR = "hsl(217, 91%, 60%)";

interface SeriesPoint {
  ts: number;
  value: number;
}

function extractSeries(data: QueryResultRow[]): {
  values: number[];
  points: SeriesPoint[];
} {
  const first = data[0];
  if (!first) return { values: [], points: [] };

  const timeKey = detectTimeKey(data);
  const valueKey = getValueKeys(first, timeKey ?? "")[0];
  if (!valueKey) return { values: [], points: [] };

  if (!timeKey) {
    const values = data
      .map((row) => row[valueKey])
      .filter((v): v is number => typeof v === "number");
    return { values, points: [] };
  }

  const points = data
    .filter((row) => typeof row[valueKey] === "number")
    .map((row) => ({
      ts: toTimestamp(row[timeKey]),
      value: row[valueKey] as number,
    }))
    .sort((a, b) => a.ts - b.ts);

  return { values: points.map((p) => p.value), points };
}

export function StatChartVisualization({ plugin, data }: VisualizationProps) {
  const spec = plugin.spec;
  const calculation = isCalculationType(spec.calculation)
    ? spec.calculation
    : "last";
  const unit = typeof spec.unit === "string" ? spec.unit : "";
  const showSparkline = spec.sparkline === true;
  const thresholds = (spec.thresholds ?? undefined) as
    | ThresholdsSpec
    | undefined;

  const { values, points } = useMemo(
    () => (data ? extractSeries(data) : { values: [], points: [] }),
    [data],
  );
  const value = useMemo(
    () => calculate(values, calculation),
    [values, calculation],
  );

  if (!data || value === undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Hash className="size-8" />
        <p className="text-sm">
          {!data ? "Configure a query to see results" : "No numeric data"}
        </p>
      </div>
    );
  }

  const seriesMax = values.length > 0 ? Math.max(...values) : 0;
  const color = resolveThresholdColor(value, thresholds, seriesMax);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p
          className="text-4xl font-semibold tabular-nums"
          style={color ? { color } : undefined}
        >
          {formatStatValue(value)}
          {unit && (
            <span className="ml-1 text-2xl text-muted-foreground">{unit}</span>
          )}
        </p>
      </div>
      {showSparkline && points.length > 1 && (
        <div className="h-1/3 max-h-24 w-full">
          <ChartContainer
            config={{
              value: { label: "value", color: color ?? SPARKLINE_COLOR },
            }}
            className="aspect-auto h-full w-full"
          >
            <AreaChart
              data={points}
              margin={{ top: 2, left: 0, right: 0, bottom: 0 }}
            >
              <Area
                dataKey="value"
                type="monotone"
                stroke="var(--color-value)"
                fill="var(--color-value)"
                fillOpacity={0.2}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register it**

In `packages/app/src/components/dashboards/visualizations/index.tsx`, add the import:

```ts
import { StatChartVisualization } from "./stat-chart/stat-chart-visualization";
```

and the registry entry (after `Table`, keeping alphabetical-ish order before `TimeSeriesChart`):

```ts
StatChart: {
  component: StatChartVisualization,
},
```

(The `settings` field is added in Task 8.)

- [ ] **Step 3: Typecheck and commit**

Run: `cd packages/app && pnpm typecheck`
Expected: clean.

```bash
git add packages/app/src/components/dashboards/visualizations/stat-chart/stat-chart-visualization.tsx packages/app/src/components/dashboards/visualizations/index.tsx
git commit -m "feat(dashboards): add StatChart visualization renderer"
```

---

### Task 8: StatChart settings UI

**Files:**
- Create: `packages/app/src/components/dashboards/visualizations/stat-chart/stat-chart-settings.tsx`
- Modify: `packages/app/src/components/dashboards/visualizations/index.tsx`

Settings panel following the `time-series-chart-settings.tsx` pattern: calculation toggle group, unit input, sparkline switch, thresholds editor (mode toggle + value/color step rows).

- [ ] **Step 1: Create the settings component**

Create `packages/app/src/components/dashboards/visualizations/stat-chart/stat-chart-settings.tsx`:

```tsx
import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { Switch } from "@everr/ui/components/switch";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { cn } from "@everr/ui/lib/utils";
import { Plus, X } from "lucide-react";
import type { VisualizationSettingsProps } from "../index";
import {
  CALCULATIONS,
  isCalculationType,
  type ThresholdsSpec,
  type ThresholdStep,
} from "./stat-calculations";

const THRESHOLD_COLORS = [
  { label: "Green", value: "#22c55e" },
  { label: "Yellow", value: "#eab308" },
  { label: "Orange", value: "#f97316" },
  { label: "Red", value: "#ef4444" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Purple", value: "#a855f7" },
] as const;

function getThresholds(spec: Record<string, unknown>): ThresholdsSpec {
  const t = spec.thresholds;
  if (t && typeof t === "object" && !Array.isArray(t)) {
    return t as ThresholdsSpec;
  }
  return {};
}

export function StatChartSettings({
  spec,
  onChange,
}: VisualizationSettingsProps) {
  const calculation = isCalculationType(spec.calculation)
    ? spec.calculation
    : "last";
  const unit = typeof spec.unit === "string" ? spec.unit : "";
  const sparkline = spec.sparkline === true;
  const thresholds = getThresholds(spec);
  const steps = thresholds.steps ?? [];

  const setThresholds = (next: ThresholdsSpec) => {
    onChange({ ...spec, thresholds: { ...next } });
  };

  const updateStep = (index: number, patch: Partial<ThresholdStep>) => {
    const nextSteps = steps.map((s, i) =>
      i === index ? { ...s, ...patch } : s,
    );
    setThresholds({ ...thresholds, steps: nextSteps });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>Calculation</Label>
        <ToggleGroup
          value={[calculation]}
          onValueChange={(next) => {
            if (next[0]) onChange({ ...spec, calculation: next[0] });
          }}
          variant="outline"
          size="sm"
        >
          {CALCULATIONS.map(({ value, label }) => (
            <ToggleGroupItem key={value} value={value} aria-label={label}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="stat-unit">Unit</Label>
        <Input
          id="stat-unit"
          value={unit}
          onChange={(e) => onChange({ ...spec, unit: e.target.value })}
          placeholder="e.g. req/s, ms, %"
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="stat-sparkline">Sparkline</Label>
        <Switch
          id="stat-sparkline"
          size="sm"
          checked={sparkline}
          onCheckedChange={(checked) =>
            onChange({ ...spec, sparkline: checked })
          }
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Thresholds</Label>
        <ToggleGroup
          value={[thresholds.mode ?? "absolute"]}
          onValueChange={(next) => {
            if (next[0]) {
              setThresholds({
                ...thresholds,
                mode: next[0] as "absolute" | "percent",
              });
            }
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="absolute" aria-label="Absolute">
            Absolute
          </ToggleGroupItem>
          <ToggleGroupItem value="percent" aria-label="Percent">
            Percent
          </ToggleGroupItem>
        </ToggleGroup>

        {steps.map((step, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: steps have no stable id
            key={index}
            className="flex items-center gap-2"
          >
            <Input
              type="number"
              value={Number.isFinite(step.value) ? String(step.value) : ""}
              onChange={(e) =>
                updateStep(index, { value: Number(e.target.value) })
              }
              aria-label={`Threshold ${index + 1} value`}
              className="w-24"
            />
            <div className="flex items-center gap-1">
              {THRESHOLD_COLORS.map(({ label, value }) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${label} threshold color`}
                  onClick={() => updateStep(index, { color: value })}
                  className={cn(
                    "size-5 rounded-full border-2",
                    step.color === value
                      ? "border-foreground"
                      : "border-transparent",
                  )}
                  style={{ backgroundColor: value }}
                />
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove threshold ${index + 1}`}
              onClick={() =>
                setThresholds({
                  ...thresholds,
                  steps: steps.filter((_, i) => i !== index),
                })
              }
            >
              <X />
            </Button>
          </div>
        ))}

        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            setThresholds({
              ...thresholds,
              steps: [
                ...steps,
                { value: 0, color: THRESHOLD_COLORS[0].value },
              ],
            })
          }
        >
          <Plus data-icon="inline-start" />
          Add threshold
        </Button>
      </div>
    </div>
  );
}
```

Note: `ThresholdStep`/`ThresholdsSpec` are stored into `plugin.spec` as plain JSON, which matches `PluginSpecValue`. If TypeScript complains about the `onChange` spec type, cast at the call site: `onChange({ ...spec, thresholds: { ...next } as Record<string, unknown> })`.

- [ ] **Step 2: Register the settings component**

In `packages/app/src/components/dashboards/visualizations/index.tsx`, import:

```ts
import { StatChartSettings } from "./stat-chart/stat-chart-settings";
```

and extend the registry entry from Task 7:

```ts
StatChart: {
  component: StatChartVisualization,
  settings: StatChartSettings,
},
```

- [ ] **Step 3: Typecheck, run viz tests, commit**

Run: `cd packages/app && pnpm typecheck && pnpm exec vitest run src/components/dashboards`
Expected: clean.

```bash
git add packages/app/src/components/dashboards/visualizations/stat-chart/stat-chart-settings.tsx packages/app/src/components/dashboards/visualizations/index.tsx
git commit -m "feat(dashboards): add StatChart settings panel"
```

---

### Task 9: Duration/refresh URL seeding (TDD)

**Files:**
- Test (create): `packages/app/src/data/dashboards/time-defaults.test.ts`
- Create: `packages/app/src/data/dashboards/time-defaults.ts`
- Modify: `packages/app/src/routes/_authenticated/_dashboard/dashboards/$dashboardId.tsx`

When a dashboard is opened with no explicit `from`/`to` (or `refresh`) in the URL, seed those params from `spec.duration` / `spec.refreshInterval` with a one-time `replace` navigation per dashboard visit. Explicit URL params always win. The global header pickers (already mounted in `_dashboard.tsx`) then display and drive everything as usual.

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/data/dashboards/time-defaults.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dashboardSearchDefaults } from "./time-defaults";

describe("dashboardSearchDefaults", () => {
  it("seeds from/to from duration when URL has neither", () => {
    expect(dashboardSearchDefaults({ duration: "1h" }, {})).toEqual({
      from: "now-1h",
      to: "now",
    });
  });

  it("does not seed when from is explicitly set", () => {
    expect(
      dashboardSearchDefaults({ duration: "1h" }, { from: "now-2d" }),
    ).toBeNull();
  });

  it("does not seed when to is explicitly set", () => {
    expect(
      dashboardSearchDefaults({ duration: "1h" }, { to: "now-1d" }),
    ).toBeNull();
  });

  it("ignores an invalid duration", () => {
    expect(dashboardSearchDefaults({ duration: "banana" }, {})).toBeNull();
  });

  it("seeds refresh from a supported refreshInterval", () => {
    expect(dashboardSearchDefaults({ refreshInterval: "30s" }, {})).toEqual({
      refresh: "30s",
    });
  });

  it("ignores an unsupported refreshInterval", () => {
    expect(dashboardSearchDefaults({ refreshInterval: "2h" }, {})).toBeNull();
  });

  it("does not override an explicit refresh param", () => {
    expect(
      dashboardSearchDefaults({ refreshInterval: "30s" }, { refresh: "5s" }),
    ).toBeNull();
  });

  it("seeds both together", () => {
    expect(
      dashboardSearchDefaults({ duration: "6h", refreshInterval: "1m" }, {}),
    ).toEqual({ from: "now-6h", to: "now", refresh: "1m" });
  });

  it("returns null when the spec has no defaults", () => {
    expect(dashboardSearchDefaults({}, {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/time-defaults.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `time-defaults.ts`**

Create `packages/app/src/data/dashboards/time-defaults.ts`:

```ts
import { isValid } from "@everr/datemath";
import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import type { DashboardSpec } from "./schema";

export interface DashboardSearchPatch {
  from?: string;
  to?: string;
  refresh?: string;
}

/**
 * Compute URL search-param defaults from a dashboard's saved
 * duration/refreshInterval. Explicit URL params always win: a field is only
 * seeded when the URL carries no value for it. Returns null when there is
 * nothing to seed.
 */
export function dashboardSearchDefaults(
  spec: Pick<DashboardSpec, "duration" | "refreshInterval">,
  search: { from?: string; to?: string; refresh?: string },
): DashboardSearchPatch | null {
  const patch: DashboardSearchPatch = {};

  if (
    !search.from &&
    !search.to &&
    spec.duration &&
    isValid(`now-${spec.duration}`)
  ) {
    patch.from = `now-${spec.duration}`;
    patch.to = "now";
  }

  if (
    !search.refresh &&
    spec.refreshInterval &&
    getRefreshIntervalMs(spec.refreshInterval) !== null
  ) {
    patch.refresh = spec.refreshInterval;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/time-defaults.test.ts`
Expected: PASS.

(If vitest fails to load `@everr/ui/components/refresh-picker` because it is a `.tsx` module, check `packages/app/vitest.config.ts` — the existing config should already handle workspace TSX imports; if not, inline a `SUPPORTED_REFRESH_VALUES = new Set(["5s","10s","30s","1m","5m"])` check in `time-defaults.ts` instead and note it mirrors `REFRESH_INTERVALS`.)

- [ ] **Step 5: Wire seeding into the dashboard route**

In `packages/app/src/routes/_authenticated/_dashboard/dashboards/$dashboardId.tsx`, update imports:

```ts
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import { dashboardOptions } from "@/data/dashboards/options";
import { dashboardSearchDefaults } from "@/data/dashboards/time-defaults";
```

In `DashboardPage`, after the existing store effect, add the one-shot seeding effect (`seededFor` guards against re-seeding when the user later picks the global default range, which gets stripped from the URL):

```tsx
const search = useSearch({ from: "/_authenticated/_dashboard" });
const navigate = useNavigate();
const seededFor = useRef<string | null>(null);

useEffect(() => {
  if (seededFor.current === dashboardId) return;
  seededFor.current = dashboardId;
  const patch = dashboardSearchDefaults(data.spec, search);
  if (patch) {
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }),
      replace: true,
    });
  }
}, [dashboardId, data, search, navigate]);
```

- [ ] **Step 6: Typecheck and commit**

Run: `cd packages/app && pnpm typecheck && pnpm exec vitest run src/data/dashboards`
Expected: clean.

```bash
git add packages/app/src/data/dashboards/time-defaults.ts packages/app/src/data/dashboards/time-defaults.test.ts packages/app/src/routes/_authenticated/_dashboard/dashboards/\$dashboardId.tsx
git commit -m "feat(dashboards): seed time range and refresh from dashboard defaults"
```

---

### Task 10: Dashboard settings dialog + server fn (TDD)

**Files:**
- Modify: `packages/app/src/data/dashboards/schema.ts`
- Modify: `packages/app/src/data/dashboards/server.ts`
- Test (modify): `packages/app/src/data/dashboards/server.test.ts`
- Modify: `packages/app/src/data/dashboards/options.ts`
- Create: `packages/app/src/components/dashboards/dashboard-settings-dialog.tsx`
- Modify: `packages/app/src/components/dashboards/dashboard-grid.tsx`

A "Settings" entry in the dashboard toolbar kebab opens a dialog to pick default duration + refresh interval. Saves immediately via read-modify-write (same pattern and concurrency caveat as `renameDashboard`).

- [ ] **Step 1: Write the failing server-fn tests**

Append to `packages/app/src/data/dashboards/server.test.ts` (add `updateDashboardSettings` to the existing `./server` import):

```ts
describe("updateDashboardSettings", () => {
  it("rejects when the dashboard is not found", async () => {
    selectImpl = () => [];
    await expect(
      updateDashboardSettings({
        data: { slug: "missing", duration: "1h" },
      }),
    ).rejects.toThrow('Dashboard "missing" not found');
    expect(mockedDb.update).not.toHaveBeenCalled();
  });

  it("sets duration and refreshInterval on the stored spec", async () => {
    selectImpl = () => [
      { id: "dash-1", spec: { panels: {}, layouts: [] } },
    ];
    updateImpl = () => undefined;

    await updateDashboardSettings({
      data: { slug: "abc", duration: "1h", refreshInterval: "30s" },
    });

    const chain = mockedDb.update.mock.results[0]!.value as {
      set: ReturnType<typeof vi.fn>;
    };
    const setArg = chain.set.mock.calls[0]![0] as { spec: Record<string, unknown> };
    expect(setArg.spec.duration).toBe("1h");
    expect(setArg.spec.refreshInterval).toBe("30s");
  });

  it("removes duration and refreshInterval when omitted", async () => {
    selectImpl = () => [
      {
        id: "dash-1",
        spec: { panels: {}, layouts: [], duration: "7d", refreshInterval: "5m" },
      },
    ];
    updateImpl = () => undefined;

    await updateDashboardSettings({ data: { slug: "abc" } });

    const chain = mockedDb.update.mock.results[0]!.value as {
      set: ReturnType<typeof vi.fn>;
    };
    const setArg = chain.set.mock.calls[0]![0] as { spec: Record<string, unknown> };
    expect(setArg.spec).not.toHaveProperty("duration");
    expect(setArg.spec).not.toHaveProperty("refreshInterval");
  });
});
```

Note: the db mock's `updateChain` is created once inside the `vi.mock` factory, so `chain.set` accumulates calls across tests — `vi.clearAllMocks()` in the existing `beforeEach` resets it. `mock.results[0]` is therefore the first `db.update(...)` call **within the current test**.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts`
Expected: FAIL — `updateDashboardSettings` is not exported.

- [ ] **Step 3: Add the input schema and server fn**

In `packages/app/src/data/dashboards/schema.ts`, after `renameDashboardInput`:

```ts
export const updateDashboardSettingsInput = z.object({
  slug: z.string().min(1),
  duration: z.string().optional(),
  refreshInterval: z.string().optional(),
});
```

In `packages/app/src/data/dashboards/server.ts`, add `updateDashboardSettingsInput` to the schema import block, then add after `renameDashboard`:

```ts
export const updateDashboardSettings = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(updateDashboardSettingsInput)
  .handler(async ({ data: { slug, duration, refreshInterval }, context }) => {
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

    const spec = { ...row.spec };
    if (duration) {
      spec.duration = duration;
    } else {
      delete spec.duration;
    }
    if (refreshInterval) {
      spec.refreshInterval = refreshInterval;
    } else {
      delete spec.refreshInterval;
    }

    await db
      .update(dashboards)
      .set({ spec, updatedAt: new Date() })
      .where(eq(dashboards.id, row.id));

    return { slug };
  });
```

- [ ] **Step 4: Run to verify the new tests pass**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the mutation hook**

In `packages/app/src/data/dashboards/options.ts`, add `updateDashboardSettings` to the `./server` import and add after `useRenameDashboard`:

```ts
export function useUpdateDashboardSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      slug: string;
      duration?: string;
      refreshInterval?: string;
    }) => updateDashboardSettings({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardsQueryKey });
      toast.success("Dashboard settings updated");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to update settings",
      );
    },
  });
}
```

- [ ] **Step 6: Create the settings dialog**

Create `packages/app/src/components/dashboards/dashboard-settings-dialog.tsx` (dropdown-as-select pattern, consistent with `refresh-picker.tsx`):

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import { Label } from "@everr/ui/components/label";
import { REFRESH_INTERVALS } from "@everr/ui/components/refresh-picker";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

const DURATION_OPTIONS = [
  { label: "Default (last 7 days)", value: "" },
  { label: "Last 5 minutes", value: "5m" },
  { label: "Last 15 minutes", value: "15m" },
  { label: "Last 30 minutes", value: "30m" },
  { label: "Last 1 hour", value: "1h" },
  { label: "Last 3 hours", value: "3h" },
  { label: "Last 6 hours", value: "6h" },
  { label: "Last 12 hours", value: "12h" },
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 2 days", value: "2d" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
] as const;

function OptionSelect({
  id,
  options,
  value,
  onChange,
}: {
  id: string;
  options: ReadonlyArray<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  const active = options.find((o) => o.value === value) ?? options[0]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            id={id}
            variant="outline"
            className="w-full justify-between font-normal"
          />
        }
      >
        {active.label}
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface DashboardSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDuration?: string;
  initialRefreshInterval?: string;
  isPending?: boolean;
  onConfirm: (settings: { duration?: string; refreshInterval?: string }) => void;
}

export function DashboardSettingsDialog({
  open,
  onOpenChange,
  initialDuration,
  initialRefreshInterval,
  isPending,
  onConfirm,
}: DashboardSettingsDialogProps) {
  const [duration, setDuration] = useState(initialDuration ?? "");
  const [refreshInterval, setRefreshInterval] = useState(
    initialRefreshInterval ?? "",
  );

  useEffect(() => {
    if (open) {
      setDuration(initialDuration ?? "");
      setRefreshInterval(initialRefreshInterval ?? "");
    }
  }, [open, initialDuration, initialRefreshInterval]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dashboard settings</DialogTitle>
          <DialogDescription>
            Defaults applied when the dashboard is opened without an explicit
            time range or refresh interval in the URL.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="dashboard-duration">Default time range</Label>
          <OptionSelect
            id="dashboard-duration"
            options={DURATION_OPTIONS}
            value={duration}
            onChange={setDuration}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="dashboard-refresh">Auto-refresh</Label>
          <OptionSelect
            id="dashboard-refresh"
            options={REFRESH_INTERVALS.map((i) => ({
              label: i.label,
              value: i.value,
            }))}
            value={refreshInterval}
            onChange={setRefreshInterval}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={isPending}
            onClick={() =>
              onConfirm({
                duration: duration || undefined,
                refreshInterval: refreshInterval || undefined,
              })
            }
          >
            {isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7: Wire into the toolbar kebab**

In `packages/app/src/components/dashboards/dashboard-grid.tsx`:

- Import `Settings2` from `lucide-react` (add to the existing lucide import) and:

  ```ts
  import { DashboardSettingsDialog } from "./dashboard-settings-dialog";
  import { useUpdateDashboardSettings } from "@/data/dashboards/options";
  ```

  (merge `useUpdateDashboardSettings` into the existing `@/data/dashboards/options` import block).

- Extend the `manageAction` state union: `"rename" | "move" | "delete" | "settings" | null`.

- Add the mutation next to the others: `const settingsMutation = useUpdateDashboardSettings();`

- Add a kebab item between "Move to folder" and the separator:

  ```tsx
  <DropdownMenuItem onClick={() => setManageAction("settings")}>
    <Settings2 />
    Settings
  </DropdownMenuItem>
  ```

- Render the dialog next to `NameDialog`/`FolderPickerDialog`. On success, patch the store spec (preserving dirty via direct `set` is unnecessary — settings are not part of edit-mode dirty tracking, but the store copy must reflect the change so the seeding effect and future saves carry it; use `setDashboard` only if NOT dirty, otherwise leave the store alone and let `router.invalidate()` refresh on next load):

  ```tsx
  <DashboardSettingsDialog
    open={manageAction === "settings"}
    onOpenChange={(open) => {
      if (!open) setManageAction(null);
    }}
    initialDuration={dashboard.spec.duration}
    initialRefreshInterval={dashboard.spec.refreshInterval}
    isPending={settingsMutation.isPending}
    onConfirm={({ duration, refreshInterval }) => {
      settingsMutation.mutate(
        { slug: dashboard.metadata.name, duration, refreshInterval },
        {
          onSuccess: () => {
            if (!useDashboardStore.getState().isDirty) {
              setDashboard({
                ...dashboard,
                spec: {
                  ...dashboard.spec,
                  ...(duration
                    ? { duration }
                    : { duration: undefined }),
                  ...(refreshInterval
                    ? { refreshInterval }
                    : { refreshInterval: undefined }),
                },
              });
            }
            void router.invalidate();
            setManageAction(null);
          },
        },
      );
    }}
  />
  ```

- [ ] **Step 8: Typecheck, full dashboards tests, commit**

Run: `cd packages/app && pnpm typecheck && pnpm exec vitest run src/data/dashboards`
Expected: clean.

```bash
git add packages/app/src/data/dashboards/schema.ts packages/app/src/data/dashboards/server.ts packages/app/src/data/dashboards/server.test.ts packages/app/src/data/dashboards/options.ts packages/app/src/components/dashboards/dashboard-settings-dialog.tsx packages/app/src/components/dashboards/dashboard-grid.tsx
git commit -m "feat(dashboards): per-dashboard default duration and refresh interval"
```

---

### Task 11: Friendly unique-violation errors + slug retry (TDD)

**Files:**
- Test (modify): `packages/app/src/data/dashboards/server.test.ts`
- Modify: `packages/app/src/data/dashboards/server.ts`

PG unique violations (code `23505`) currently surface raw SQL errors in toasts. Map folder name collisions to a friendly message and retry dashboard slug collisions.

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/src/data/dashboards/server.test.ts` (add `createFolder` and `renameFolder` to the `./server` import):

```ts
function uniqueViolation(): Error {
  return Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
  });
}

describe("createFolder – duplicate name", () => {
  it("maps a unique violation to a friendly error", async () => {
    insertImpl = () => {
      throw uniqueViolation();
    };
    await expect(
      createFolder({ data: { name: "Production" } }),
    ).rejects.toThrow("A folder with this name already exists here");
  });

  it("recognizes a unique violation wrapped in error.cause", async () => {
    insertImpl = () => {
      throw Object.assign(new Error("query failed"), {
        cause: uniqueViolation(),
      });
    };
    await expect(
      createFolder({ data: { name: "Production" } }),
    ).rejects.toThrow("A folder with this name already exists here");
  });

  it("rethrows unrelated errors untouched", async () => {
    insertImpl = () => {
      throw new Error("connection refused");
    };
    await expect(
      createFolder({ data: { name: "Production" } }),
    ).rejects.toThrow("connection refused");
  });
});

describe("renameFolder – duplicate name", () => {
  it("maps a unique violation to a friendly error", async () => {
    updateImpl = () => {
      throw uniqueViolation();
    };
    await expect(
      renameFolder({
        data: {
          folderId: "11111111-1111-1111-1111-111111111111",
          name: "Production",
        },
      }),
    ).rejects.toThrow("A folder with this name already exists here");
  });
});

describe("createDashboard – slug collision retry", () => {
  it("retries on slug collision and succeeds", async () => {
    let attempts = 0;
    insertImpl = () => {
      attempts++;
      if (attempts < 3) throw uniqueViolation();
      return [{ slug: "zzzzzzzzzzzz" }];
    };

    const result = await createDashboard({
      data: { spec: { panels: {}, layouts: [] } },
    });

    expect(result.slug).toBe("zzzzzzzzzzzz");
    expect(attempts).toBe(3);
  });

  it("gives up after three attempts", async () => {
    let attempts = 0;
    insertImpl = () => {
      attempts++;
      throw uniqueViolation();
    };

    await expect(
      createDashboard({ data: { spec: { panels: {}, layouts: [] } } }),
    ).rejects.toThrow();
    expect(attempts).toBe(3);
  });

  it("does not retry on unrelated insert errors", async () => {
    let attempts = 0;
    insertImpl = () => {
      attempts++;
      throw new Error("connection refused");
    };

    await expect(
      createDashboard({ data: { spec: { panels: {}, layouts: [] } } }),
    ).rejects.toThrow("connection refused");
    expect(attempts).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts`
Expected: the new describes FAIL (raw errors / single attempt).

- [ ] **Step 3: Implement in `server.ts`**

Add near the top of `packages/app/src/data/dashboards/server.ts` (after `generateDashboardSlug`):

```ts
const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ((error as { code?: unknown }).code === PG_UNIQUE_VIOLATION) return true;
  return isUniqueViolation((error as { cause?: unknown }).cause);
}
```

Replace the `createDashboard` handler body's insert with a retry loop:

```ts
.handler(async ({ data: { spec, folderId }, context }) => {
  const orgId = context.session.session.activeOrganizationId;

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

Wrap the `createFolder` insert:

```ts
.handler(async ({ data: { name, parentId }, context }) => {
  const orgId = context.session.session.activeOrganizationId;

  try {
    const [row] = await db
      .insert(dashboardFolders)
      .values({
        organizationId: orgId,
        parentId: parentId ?? null,
        name,
      })
      .returning({ id: dashboardFolders.id });

    return { id: row?.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("A folder with this name already exists here");
    }
    throw error;
  }
});
```

Wrap the `renameFolder` update the same way:

```ts
.handler(async ({ data: { folderId, name }, context }) => {
  const orgId = context.session.session.activeOrganizationId;

  try {
    await db
      .update(dashboardFolders)
      .set({ name, updatedAt: new Date() })
      .where(
        and(
          eq(dashboardFolders.id, folderId),
          eq(dashboardFolders.organizationId, orgId),
        ),
      );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("A folder with this name already exists here");
    }
    throw error;
  }

  return { id: folderId };
});
```

- [ ] **Step 4: Run to verify everything passes**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts`
Expected: PASS (all describes, including pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/data/dashboards/server.ts packages/app/src/data/dashboards/server.test.ts
git commit -m "fix(dashboards): friendly duplicate-folder errors and slug-collision retry"
```

---

### Task 12: a11y labels on tree and toolbar controls

**Files:**
- Modify: `packages/app/src/components/dashboards/dashboard-tree.tsx`
- Modify: `packages/app/src/components/dashboards/dashboard-grid.tsx`

- [ ] **Step 1: Label the tree kebabs and expand/collapse buttons**

In `packages/app/src/components/dashboards/dashboard-tree.tsx`:

`KebabTrigger` (line ~412) — accept and apply a label:

```tsx
function KebabTrigger({ label }: { label: string }) {
  return (
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
        />
      }
    >
      <EllipsisVertical />
    </DropdownMenuTrigger>
  );
}
```

Update every `<KebabTrigger />` usage: in `FolderMenu` use `<KebabTrigger label={`Folder actions: ${folder.name}`} />`; in `DashboardMenu` use `<KebabTrigger label={`Dashboard actions: ${dashboard.name}`} />` (check the actual prop names in those two components — `FolderMenu` receives `folder: FolderSummary`, `DashboardMenu` receives `dashboard: DashboardSummary`).

Folder expand/collapse button in `FolderRows` (line ~306–320) — add to the `<button>`:

```tsx
aria-label={`${isExpanded ? "Collapse" : "Expand"} folder ${node.folder.name}`}
aria-expanded={isExpanded}
```

- [ ] **Step 2: Label the dashboard toolbar kebab**

In `packages/app/src/components/dashboards/dashboard-grid.tsx`, the toolbar kebab trigger (line ~307):

```tsx
<DropdownMenuTrigger
  render={<Button variant="ghost" size="icon" aria-label="Dashboard actions" />}
>
  <EllipsisVertical />
</DropdownMenuTrigger>
```

- [ ] **Step 3: Typecheck and commit**

Run: `cd packages/app && pnpm typecheck`
Expected: clean.

```bash
git add packages/app/src/components/dashboards/dashboard-tree.tsx packages/app/src/components/dashboards/dashboard-grid.tsx
git commit -m "fix(dashboards): add aria-labels to tree and toolbar controls"
```

---

### Task 13: Full verification, browser check, docs update

**Files:**
- Modify: `DASHBOARD_FEATURES.md`

- [ ] **Step 1: Full test suite + typecheck**

Run: `cd packages/app && pnpm exec vitest run && pnpm typecheck`
Expected: all tests pass, typecheck clean. Fix anything that fails before continuing.

- [ ] **Step 2: Browser verification**

Use the dev server already running on `http://localhost:5173` (do NOT start a second instance — it breaks auth; if none is running, start one with `pnpm dev` from the repo root in the background and wait for it). Verify with Playwright (cached Chrome binary, `waitUntil: "load"`, NOT `networkidle`) or manual instructions:

1. **StatChart:** open a dashboard → edit → add panel → open panel editor → set a query like `SELECT count() AS value FROM logs WHERE timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}` (adapt to an existing working panel query from another panel) → pick the Stat chart type → confirm big number renders; toggle sparkline with a time-bucketed query; add a threshold below the value and confirm the color applies; Apply.
2. **Unsaved changes:** in edit mode move a panel → click the "Dashboards" breadcrumb → confirm the "Unsaved changes" dialog appears → Stay → Save → navigate away without a dialog. Repeat with Discard & leave and confirm the edit is gone on return.
3. **Panel errors:** set a panel query to invalid SQL (`SELECT bogus FROM nowhere`) via the editor Run Query → error renders in the preview region; Apply + Save → grid panel shows the error card with message.
4. **Duration/refresh:** kebab → Settings → set "Last 1 hour" + auto-refresh 30s → Save → navigate to `/dashboards` then back to the dashboard with no URL params → URL gains `from=now-1h&to=now&refresh=30s` and pickers reflect them. Then open with explicit `?from=now-2d&to=now` → explicit range wins.
5. **Friendly errors:** create a folder, then create another with the same name in the same parent → toast says "A folder with this name already exists here".
6. **a11y spot check:** inspect a tree row kebab and the toolbar kebab → `aria-label` present.

- [ ] **Step 3: Update `DASHBOARD_FEATURES.md`**

Update the status entries to match reality:

- StatChart line → `✅ **StatChart** — calculation (last/first/mean/min/max/sum), unit, optional sparkline, absolute/percent threshold coloring`
- Unsaved-changes line → `✅ Unsaved-changes protection — dirty tracking in the store, route blocker with confirm dialog, beforeunload on tab close`
- Panel error states line → `✅ Panel-level error states — grid panels and editor preview render query failures with the error message`
- Time range section → `✅ Per-dashboard duration / auto-refreshInterval — saved via toolbar kebab → Settings; seeds URL params when absent (explicit URL always wins)`
- Known rough edges: remove the duplicate-folder-name, aria-label, and slug-collision bullets; keep the `renameDashboard` read-modify-write caveat and extend it to mention `updateDashboardSettings` shares it.
- Update the `_Last updated:_` line to the current date and branch `gio/dashboard-v1-polish`.

- [ ] **Step 4: Commit**

```bash
git add DASHBOARD_FEATURES.md
git commit -m "docs: update dashboard feature status for v1 polish"
```
