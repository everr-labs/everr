# Panel Edit Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-page panel editor at `/dashboards/:dashboardId/panel/:panelKey` with a live preview, ClickHouse SQL query editor, and visualization options — using a zustand store for cross-route state.

**Architecture:** A zustand store (`useDashboardStore`) replaces the local `useState` in `DashboardGrid` and is shared with the new panel edit route. The edit page maintains a local draft of the panel; "Apply" commits it to the store, "Discard" navigates back. The panel edit route is a flat sibling (uses TanStack Router's `_` suffix to break layout nesting) so it renders outside the dashboard grid but inside the `_dashboard` layout shell.

**Tech Stack:** React, TanStack Router (file-based), TanStack React Query, zustand, Recharts, shadcn/base-ui components (`Tabs`, `ToggleGroup`, `Input`, `Textarea`, `Label`, `Button`)

**Spec:** `docs/superpowers/specs/2026-05-25-panel-edit-page-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/app/src/data/dashboards/dashboard-store.ts` | Create | Zustand store: holds `Dashboard`, exposes `setDashboard`, `updatePanel`, `updateLayout` |
| `packages/app/src/routes/_authenticated/_dashboard/dashboards.$dashboardId.tsx` | Modify | Initialize zustand store from React Query data |
| `packages/app/src/components/dashboards/dashboard-grid.tsx` | Modify | Replace `useState(initial)` with zustand store |
| `packages/app/src/components/dashboards/dashboard-panel.tsx` | Modify | Add edit link that navigates to panel edit route |
| `packages/app/src/routes/_authenticated/_dashboard/dashboards.$dashboardId_.panel.$panelKey.tsx` | Create | Route file for panel edit page |
| `packages/app/src/components/dashboards/panel-edit-page.tsx` | Create | Main edit page layout (preview + tabbed editor) |
| `packages/app/src/components/dashboards/panel-preview.tsx` | Create | Live panel preview using PanelShell |
| `packages/app/src/components/dashboards/query-editor.tsx` | Create | ClickHouse SQL textarea |
| `packages/app/src/components/dashboards/viz-options.tsx` | Create | Chart type picker + display options form |

---

## Task 1: Install zustand

**Files:**
- Modify: `packages/app/package.json`

- [ ] **Step 1: Install zustand**

```bash
cd packages/app && pnpm add zustand
```

- [ ] **Step 2: Verify installation**

```bash
pnpm ls zustand --filter @everr/app
```

Expected: zustand version listed.

- [ ] **Step 3: Commit**

```bash
git add packages/app/package.json pnpm-lock.yaml
git commit -m "feat(dashboards): add zustand dependency for dashboard state"
```

---

## Task 2: Create the zustand store

**Files:**
- Create: `packages/app/src/data/dashboards/dashboard-store.ts`

- [ ] **Step 1: Create the store file**

```ts
// packages/app/src/data/dashboards/dashboard-store.ts
import { create } from "zustand";
import type { Dashboard, GridLayout, Panel } from "./types";

interface DashboardState {
  dashboard: Dashboard | null;
  setDashboard: (d: Dashboard) => void;
  updatePanel: (key: string, panel: Panel) => void;
  updateLayout: (layouts: GridLayout[]) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  dashboard: null,

  setDashboard: (dashboard) => set({ dashboard }),

  updatePanel: (key, panel) =>
    set((state) => {
      if (!state.dashboard) return state;
      return {
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
        dashboard: {
          ...state.dashboard,
          spec: { ...state.dashboard.spec, layouts },
        },
      };
    }),
}));
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/data/dashboards/dashboard-store.ts
git commit -m "feat(dashboards): create zustand store for dashboard state"
```

---

## Task 3: Wire the store into the dashboard route and grid

**Files:**
- Modify: `packages/app/src/routes/_authenticated/_dashboard/dashboards.$dashboardId.tsx`
- Modify: `packages/app/src/components/dashboards/dashboard-grid.tsx`

- [ ] **Step 1: Update the dashboard route to initialize the store**

Replace the current `DashboardPage` component in `dashboards.$dashboardId.tsx` with:

```tsx
// packages/app/src/routes/_authenticated/_dashboard/dashboards.$dashboardId.tsx
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
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
  loader: async ({ context: { queryClient }, params: { dashboardId } }) => {
    await queryClient.prefetchQuery(dashboardOptions(dashboardId));
  },
});

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

- [ ] **Step 2: Refactor DashboardGrid to use the store**

Replace the contents of `dashboard-grid.tsx`:

```tsx
// packages/app/src/components/dashboards/dashboard-grid.tsx
import { Button } from "@everr/ui/components/button";
import { LayoutDashboard, Pencil, Plus, Save } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { Layout, LayoutItem } from "react-grid-layout";
import {
  GridLayout,
  useContainerWidth,
  verticalCompactor,
} from "react-grid-layout";
import { toast } from "sonner";
import {
  panelRefFromKey,
  persesToRGL,
  rglToPerses,
} from "@/data/dashboards/convert";
import type { Panel } from "@/data/dashboards/types";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import { DashboardPanel } from "./dashboard-panel";

const GRID_COLS = 24;
const ROW_HEIGHT = 30;

function generatePanelKey(panels: Record<string, Panel>): string {
  let i = 1;
  while (`panel${i}` in panels) i++;
  return `panel${i}`;
}

export function DashboardGrid() {
  const dashboard = useDashboardStore((s) => s.dashboard);
  const updatePanel = useDashboardStore((s) => s.updatePanel);
  const updateLayout = useDashboardStore((s) => s.updateLayout);
  const setDashboard = useDashboardStore((s) => s.setDashboard);

  const [isEditing, setIsEditing] = useState(false);
  const { width, containerRef } = useContainerWidth({
    measureBeforeMount: true,
  });

  const layout = useMemo(() => {
    if (!dashboard) return [];
    const firstLayout = dashboard.spec.layouts[0];
    if (!firstLayout) return [];
    return persesToRGL(firstLayout.spec.items);
  }, [dashboard]);

  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      if (!dashboard) return;
      updateLayout([
        {
          kind: "Grid" as const,
          spec: {
            ...dashboard.spec.layouts[0]?.spec,
            items: rglToPerses([...newLayout]),
          },
        },
        ...dashboard.spec.layouts.slice(1),
      ]);
    },
    [dashboard, updateLayout],
  );

  const handleAddPanel = useCallback(() => {
    if (!dashboard) return;
    const key = generatePanelKey(dashboard.spec.panels);
    const newPanel: Panel = {
      kind: "Panel",
      spec: {
        display: { name: "New Panel" },
        plugin: { kind: "TimeSeriesChart", spec: {} },
      },
    };

    const maxY =
      dashboard.spec.layouts[0]?.spec.items.reduce(
        (max, item) => Math.max(max, item.y + item.height),
        0,
      ) ?? 0;

    updatePanel(key, newPanel);
    updateLayout([
      {
        kind: "Grid" as const,
        spec: {
          ...dashboard.spec.layouts[0]?.spec,
          items: [
            ...(dashboard.spec.layouts[0]?.spec.items ?? []),
            {
              x: 0,
              y: maxY,
              width: 12,
              height: 8,
              content: { $ref: panelRefFromKey(key) },
            },
          ],
        },
      },
      ...dashboard.spec.layouts.slice(1),
    ]);
  }, [dashboard, updatePanel, updateLayout]);

  const handleRemovePanel = useCallback(
    (panelKey: string) => {
      if (!dashboard) return;
      const { [panelKey]: _, ...remainingPanels } = dashboard.spec.panels;
      setDashboard({
        ...dashboard,
        spec: {
          ...dashboard.spec,
          panels: remainingPanels,
          layouts: [
            {
              kind: "Grid" as const,
              spec: {
                ...dashboard.spec.layouts[0]?.spec,
                items: (dashboard.spec.layouts[0]?.spec.items ?? []).filter(
                  (item) => item.content.$ref !== panelRefFromKey(panelKey),
                ),
              },
            },
            ...dashboard.spec.layouts.slice(1),
          ],
        },
      });
    },
    [dashboard, setDashboard],
  );

  const handleSave = useCallback(() => {
    toast.info("Dashboard saved (mock — no persistence yet)");
  }, []);

  if (!dashboard) return null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">
            {dashboard.spec.display?.name ?? dashboard.metadata.name}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isEditing && (
            <>
              <Button variant="outline" size="sm" onClick={handleAddPanel}>
                <Plus data-icon="inline-start" />
                Add Panel
              </Button>
              <Button size="sm" onClick={handleSave}>
                <Save data-icon="inline-start" />
                Save
              </Button>
            </>
          )}
          <Button
            variant={isEditing ? "default" : "outline"}
            size="sm"
            onClick={() => setIsEditing((v) => !v)}
          >
            <Pencil data-icon="inline-start" />
            {isEditing ? "Done" : "Edit"}
          </Button>
        </div>
      </div>

      <div ref={containerRef}>
        <GridLayout
          width={width}
          className={isEditing ? "layout layout-editing" : "layout"}
          layout={layout}
          gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT }}
          dragConfig={{
            enabled: isEditing,
            handle: ".drag-handle",
            bounded: true,
          }}
          resizeConfig={{ enabled: isEditing, handles: ["se"] }}
          onLayoutChange={handleLayoutChange}
          compactor={verticalCompactor}
          autoSize
        >
          {layout.map((item: LayoutItem) => {
            const panel = dashboard.spec.panels[item.i];
            if (!panel) return null;
            return (
              <div key={item.i}>
                <DashboardPanel
                  panel={panel}
                  panelKey={item.i}
                  isEditing={isEditing}
                  onRemove={() => handleRemovePanel(item.i)}
                />
              </div>
            );
          })}
        </GridLayout>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Start the dev server and verify the dashboard grid still works**

```bash
pnpm dev
```

Navigate to `/dashboards/default`. Verify:
- Panels render with correct titles
- Edit mode toggle works (add panel, remove panel, drag, resize)
- No console errors

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/routes/_authenticated/_dashboard/dashboards.\$dashboardId.tsx packages/app/src/components/dashboards/dashboard-grid.tsx
git commit -m "refactor(dashboards): migrate dashboard state from useState to zustand store"
```

---

## Task 4: Add edit button to DashboardPanel

**Files:**
- Modify: `packages/app/src/components/dashboards/dashboard-panel.tsx`

- [ ] **Step 1: Add edit link to the panel header**

Replace the contents of `dashboard-panel.tsx`:

```tsx
// packages/app/src/components/dashboards/dashboard-panel.tsx
import { Button } from "@everr/ui/components/button";
import { Link } from "@tanstack/react-router";
import { Pencil, X } from "lucide-react";
import type { Panel } from "@/data/dashboards/types";
import { PanelShell } from "../panel-shell";

interface DashboardPanelProps {
  panel: Panel;
  panelKey: string;
  dashboardId: string;
  isEditing: boolean;
  onRemove?: () => void;
}

export function DashboardPanel({
  panel,
  panelKey,
  dashboardId,
  isEditing,
  onRemove,
}: DashboardPanelProps) {
  const { display, plugin } = panel.spec;

  return (
    <PanelShell
      title={display.name ?? panelKey}
      description={display.description}
      status="success"
      className="h-full"
      headerClassName={
        isEditing ? "drag-handle cursor-grab active:cursor-grabbing" : undefined
      }
      action={
        isEditing ? (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              render={
                <Link
                  to="/dashboards/$dashboardId/panel/$panelKey"
                  params={{ dashboardId, panelKey }}
                />
              }
              aria-label="Edit panel"
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onRemove}
              aria-label="Remove panel"
            >
              <X />
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">{plugin.kind}</p>
      </div>
    </PanelShell>
  );
}
```

- [ ] **Step 2: Update DashboardGrid to pass dashboardId**

In `dashboard-grid.tsx`, the `DashboardPanel` now requires a `dashboardId` prop. Add it to the render call. Find the `<DashboardPanel` JSX and add:

```tsx
<DashboardPanel
  panel={panel}
  panelKey={item.i}
  dashboardId={dashboard.metadata.name}
  isEditing={isEditing}
  onRemove={() => handleRemovePanel(item.i)}
/>
```

- [ ] **Step 3: Verify in the browser**

Navigate to `/dashboards/default`, toggle Edit mode. Each panel header should now show a pencil icon button next to the X remove button. Clicking the pencil should attempt to navigate to `/dashboards/default/panel/<panelKey>` (will show 404 — that's expected, we haven't created the route yet).

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/components/dashboards/dashboard-panel.tsx packages/app/src/components/dashboards/dashboard-grid.tsx
git commit -m "feat(dashboards): add edit button to panel header"
```

---

## Task 5: Create the panel edit route and page layout

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/dashboards.$dashboardId_.panel.$panelKey.tsx`
- Create: `packages/app/src/components/dashboards/panel-edit-page.tsx`

- [ ] **Step 1: Create the route file**

```tsx
// packages/app/src/routes/_authenticated/_dashboard/dashboards.$dashboardId_.panel.$panelKey.tsx
import { createFileRoute } from "@tanstack/react-router";
import { PanelEditPage } from "@/components/dashboards/panel-edit-page";
import { dashboardOptions } from "@/data/dashboards/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboards/$dashboardId_/panel/$panelKey",
)({
  staticData: { breadcrumb: "Edit Panel", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Edit Panel" }],
  }),
  component: PanelEditRoute,
  loader: async ({ context: { queryClient }, params: { dashboardId } }) => {
    await queryClient.prefetchQuery(dashboardOptions(dashboardId));
  },
});

function PanelEditRoute() {
  const { dashboardId, panelKey } = Route.useParams();
  return <PanelEditPage dashboardId={dashboardId} panelKey={panelKey} />;
}
```

- [ ] **Step 2: Create the panel edit page component**

```tsx
// packages/app/src/components/dashboards/panel-edit-page.tsx
import { Button } from "@everr/ui/components/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@everr/ui/components/tabs";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import { dashboardOptions } from "@/data/dashboards/options";
import type { Panel } from "@/data/dashboards/types";
import { PanelPreview } from "./panel-preview";
import { QueryEditor } from "./query-editor";
import { VizOptions } from "./viz-options";

interface PanelEditPageProps {
  dashboardId: string;
  panelKey: string;
}

export function PanelEditPage({ dashboardId, panelKey }: PanelEditPageProps) {
  const navigate = useNavigate();
  const storeDashboard = useDashboardStore((s) => s.dashboard);
  const setDashboard = useDashboardStore((s) => s.setDashboard);
  const updatePanel = useDashboardStore((s) => s.updatePanel);

  const { data: fetchedDashboard } = useSuspenseQuery(
    dashboardOptions(dashboardId),
  );

  useEffect(() => {
    if (!storeDashboard) {
      setDashboard(fetchedDashboard);
    }
  }, [storeDashboard, fetchedDashboard, setDashboard]);

  const dashboard = storeDashboard ?? fetchedDashboard;
  const panel = dashboard.spec.panels[panelKey];

  const [draft, setDraft] = useState<Panel | null>(panel ?? null);

  useEffect(() => {
    if (panel && !draft) {
      setDraft(panel);
    }
  }, [panel, draft]);

  if (!draft) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>Panel "{panelKey}" not found.</p>
      </div>
    );
  }

  const handleApply = () => {
    updatePanel(panelKey, draft);
    navigate({
      to: "/dashboards/$dashboardId",
      params: { dashboardId },
    });
  };

  const handleDiscard = () => {
    navigate({
      to: "/dashboards/$dashboardId",
      params: { dashboardId },
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Link
            to="/dashboards/$dashboardId"
            params={{ dashboardId }}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-sm font-semibold">
            {draft.spec.display.name ?? panelKey}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleDiscard}>
            Discard
          </Button>
          <Button size="sm" onClick={handleApply}>
            Apply
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b p-4" style={{ minHeight: "240px" }}>
          <PanelPreview panel={draft} panelKey={panelKey} />
        </div>

        <Tabs defaultValue="query" className="min-h-0 flex-1 p-4">
          <TabsList variant="line">
            <TabsTrigger value="query">Query</TabsTrigger>
            <TabsTrigger value="visualization">Visualization</TabsTrigger>
          </TabsList>
          <TabsContent value="query" className="pt-4">
            <QueryEditor draft={draft} onChange={setDraft} />
          </TabsContent>
          <TabsContent value="visualization" className="pt-4">
            <VizOptions draft={draft} onChange={setDraft} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create stub files for PanelPreview, QueryEditor, VizOptions**

Create minimal placeholders so the page renders:

```tsx
// packages/app/src/components/dashboards/panel-preview.tsx
import type { Panel } from "@/data/dashboards/types";
import { PanelShell } from "../panel-shell";

interface PanelPreviewProps {
  panel: Panel;
  panelKey: string;
}

export function PanelPreview({ panel, panelKey }: PanelPreviewProps) {
  const { display, plugin } = panel.spec;

  return (
    <PanelShell
      title={display.name ?? panelKey}
      description={display.description}
      status="success"
      className="h-full"
    >
      <div className="flex h-full min-h-32 items-center justify-center text-muted-foreground">
        <p className="text-sm">{plugin.kind}</p>
      </div>
    </PanelShell>
  );
}
```

```tsx
// packages/app/src/components/dashboards/query-editor.tsx
import type { Panel } from "@/data/dashboards/types";

interface QueryEditorProps {
  draft: Panel;
  onChange: (panel: Panel) => void;
}

export function QueryEditor({ draft, onChange }: QueryEditorProps) {
  return <div className="text-sm text-muted-foreground">Query editor placeholder</div>;
}
```

```tsx
// packages/app/src/components/dashboards/viz-options.tsx
import type { Panel } from "@/data/dashboards/types";

interface VizOptionsProps {
  draft: Panel;
  onChange: (panel: Panel) => void;
}

export function VizOptions({ draft, onChange }: VizOptionsProps) {
  return <div className="text-sm text-muted-foreground">Visualization options placeholder</div>;
}
```

- [ ] **Step 4: Verify in the browser**

Start the dev server. Navigate to `/dashboards/default`, toggle Edit mode, click the pencil icon on any panel. You should land on `/dashboards/default/panel/<panelKey>` and see:
- Back arrow + panel title + Discard/Apply buttons in the header
- Panel preview card showing the plugin kind
- Two tabs: Query and Visualization (showing placeholder text)
- Click Discard → returns to dashboard
- Click Apply → returns to dashboard

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes/_authenticated/_dashboard/dashboards.\$dashboardId_.panel.\$panelKey.tsx packages/app/src/components/dashboards/panel-edit-page.tsx packages/app/src/components/dashboards/panel-preview.tsx packages/app/src/components/dashboards/query-editor.tsx packages/app/src/components/dashboards/viz-options.tsx
git commit -m "feat(dashboards): add panel edit page with route, layout, and stubs"
```

---

## Task 6: Implement the Query Editor

**Files:**
- Modify: `packages/app/src/components/dashboards/query-editor.tsx`

- [ ] **Step 1: Implement the ClickHouse SQL query editor**

```tsx
// packages/app/src/components/dashboards/query-editor.tsx
import { Button } from "@everr/ui/components/button";
import { Label } from "@everr/ui/components/label";
import { Textarea } from "@everr/ui/components/textarea";
import { Play } from "lucide-react";
import type { Panel, PanelQuery } from "@/data/dashboards/types";

interface QueryEditorProps {
  draft: Panel;
  onChange: (panel: Panel) => void;
}

function getQueryText(draft: Panel): string {
  const firstQuery = draft.spec.queries?.[0];
  if (!firstQuery) return "";
  const querySpec = firstQuery.spec.plugin.spec;
  return typeof querySpec.query === "string" ? querySpec.query : "";
}

function setQueryText(draft: Panel, query: string): Panel {
  const newQuery: PanelQuery = {
    kind: "ClickHouseSQL",
    spec: {
      plugin: {
        kind: "ClickHouseSQL",
        spec: { query },
      },
    },
  };

  return {
    ...draft,
    spec: {
      ...draft.spec,
      queries: [newQuery, ...(draft.spec.queries?.slice(1) ?? [])],
    },
  };
}

export function QueryEditor({ draft, onChange }: QueryEditorProps) {
  const queryText = getQueryText(draft);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="query-editor">ClickHouse SQL</Label>
          <Button variant="outline" size="sm" disabled>
            <Play data-icon="inline-start" />
            Run Query
          </Button>
        </div>
        <Textarea
          id="query-editor"
          value={queryText}
          onChange={(e) => onChange(setQueryText(draft, e.target.value))}
          placeholder="SELECT * FROM ..."
          className="min-h-32 font-mono text-xs"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in the browser**

Navigate to a panel edit page. The Query tab should show:
- "ClickHouse SQL" label with a disabled "Run Query" button
- A monospace textarea that accepts SQL input
- Type some SQL, switch to Visualization tab and back — the text persists

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/dashboards/query-editor.tsx
git commit -m "feat(dashboards): implement ClickHouse SQL query editor"
```

---

## Task 7: Implement the Visualization Options

**Files:**
- Modify: `packages/app/src/components/dashboards/viz-options.tsx`

- [ ] **Step 1: Implement chart type picker and display options**

```tsx
// packages/app/src/components/dashboards/viz-options.tsx
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { Textarea } from "@everr/ui/components/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { Hash, LineChart, Table } from "lucide-react";
import type { Panel } from "@/data/dashboards/types";

interface VizOptionsProps {
  draft: Panel;
  onChange: (panel: Panel) => void;
}

const CHART_TYPES = [
  { kind: "TimeSeriesChart", label: "Time Series", icon: LineChart },
  { kind: "StatChart", label: "Stat", icon: Hash },
  { kind: "Table", label: "Table", icon: Table },
] as const;

export function VizOptions({ draft, onChange }: VizOptionsProps) {
  const pluginKind = draft.spec.plugin.kind;

  const handleKindChange = (next: string[]) => {
    const selected = next[0];
    if (!selected) return;
    onChange({
      ...draft,
      spec: {
        ...draft.spec,
        plugin: { ...draft.spec.plugin, kind: selected },
      },
    });
  };

  const handleDisplayName = (name: string) => {
    onChange({
      ...draft,
      spec: {
        ...draft.spec,
        display: { ...draft.spec.display, name },
      },
    });
  };

  const handleDescription = (description: string) => {
    onChange({
      ...draft,
      spec: {
        ...draft.spec,
        display: { ...draft.spec.display, description },
      },
    });
  };

  const handleUnit = (unit: string) => {
    onChange({
      ...draft,
      spec: {
        ...draft.spec,
        plugin: {
          ...draft.spec.plugin,
          spec: { ...draft.spec.plugin.spec, unit },
        },
      },
    });
  };

  const handleShowLegend = (next: string[]) => {
    onChange({
      ...draft,
      spec: {
        ...draft.spec,
        plugin: {
          ...draft.spec.plugin,
          spec: {
            ...draft.spec.plugin.spec,
            showLegend: next.includes("showLegend"),
          },
        },
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label>Chart Type</Label>
        <ToggleGroup
          value={[pluginKind]}
          onValueChange={handleKindChange}
          variant="outline"
          size="sm"
        >
          {CHART_TYPES.map(({ kind, label, icon: Icon }) => (
            <ToggleGroupItem key={kind} value={kind} aria-label={label}>
              <Icon className="size-3.5" />
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="panel-title">Title</Label>
          <Input
            id="panel-title"
            value={draft.spec.display.name ?? ""}
            onChange={(e) => handleDisplayName(e.target.value)}
            placeholder="Panel title"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="panel-unit">Unit</Label>
          <Input
            id="panel-unit"
            value={
              typeof draft.spec.plugin.spec.unit === "string"
                ? draft.spec.plugin.spec.unit
                : ""
            }
            onChange={(e) => handleUnit(e.target.value)}
            placeholder="e.g. req/s, ms, %"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="panel-description">Description</Label>
        <Textarea
          id="panel-description"
          value={draft.spec.display.description ?? ""}
          onChange={(e) => handleDescription(e.target.value)}
          placeholder="Optional description"
        />
      </div>

      {pluginKind === "TimeSeriesChart" && (
        <div className="flex flex-col gap-2">
          <Label>Legend</Label>
          <ToggleGroup
            value={draft.spec.plugin.spec.showLegend ? ["showLegend"] : []}
            onValueChange={handleShowLegend}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="showLegend" aria-label="Show legend">
              Show legend
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify in the browser**

Navigate to a panel edit page, click the Visualization tab. Verify:
- Chart type toggle group shows three options, current type is selected
- Switching types updates the preview header (plugin kind label)
- Title input updates the preview panel title in real-time
- Description and unit inputs work
- "Show legend" toggle only appears when TimeSeriesChart is selected
- Switch to StatChart → legend toggle disappears. Switch back → it reappears.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/dashboards/viz-options.tsx
git commit -m "feat(dashboards): implement visualization options with chart type picker"
```

---

## Task 8: End-to-end verification

- [ ] **Step 1: Full flow test**

Start the dev server and run through the complete flow:

1. Navigate to `/dashboards/default`
2. Toggle Edit mode
3. Click the pencil icon on the "Request Rate" panel
4. Verify the edit page loads with title "Request Rate" and chart type "TimeSeriesChart"
5. **Query tab:** Type `SELECT count() FROM spans` — verify text persists when switching tabs
6. **Visualization tab:** Change title to "Request Rate v2" — verify preview updates
7. Change chart type to "StatChart" — verify preview shows "StatChart", legend toggle disappears
8. Change chart type back to "TimeSeriesChart" — legend toggle reappears
9. Set unit to "req/s"
10. Click **Apply** — verify you return to the dashboard and the panel now shows title "Request Rate v2"
11. Click Edit again, click pencil on the same panel — verify the changes persisted in the store
12. Click **Discard** — verify you return to the dashboard and the panel still shows "Request Rate v2" (the previously applied changes)
13. Edit a different panel, make changes, click Discard — verify that panel is unchanged

- [ ] **Step 2: Refresh resilience test**

1. Navigate to `/dashboards/default/panel/requestRate` directly (type the URL)
2. Verify the page loads correctly (the loader fetches dashboard data and initializes the store)
3. Make edits, apply, verify dashboard reflects changes

- [ ] **Step 3: Commit any fixes**

If any fixes were needed during verification, commit them:

```bash
git add -u
git commit -m "fix(dashboards): panel edit page polish from end-to-end testing"
```
