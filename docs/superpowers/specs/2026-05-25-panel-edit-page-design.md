# Panel Edit Page — Design Spec

## Context

The dashboard feature currently supports viewing, adding, removing, and rearranging panels via a react-grid-layout grid. However, there is no way to edit a panel's query, visualization type, or display options. Users need a dedicated panel edit page — conceptually similar to Grafana's — where they can configure a panel's query and visualization, with a live preview.

## Overview

A new route at `/dashboards/:dashboardId/panel/:panelKey` renders a full-page editor with:
- A **panel preview** (top) showing the panel as it will appear on the dashboard
- A **tabbed editor** (bottom) with Query and Visualization tabs

Dashboard state is shared between the grid page and the edit page via a **zustand store** scoped to the dashboard.

## State Management — Zustand Store

### Store: `useDashboardStore`

```ts
interface DashboardStore {
  dashboard: Dashboard;
  setDashboard: (d: Dashboard) => void;
  updatePanel: (key: string, panel: Panel) => void;
  updateLayout: (layouts: GridLayout[]) => void;
}
```

- **Initialization:** The dashboard route component (`dashboards.$dashboardId.tsx`) initializes the store from React Query data on mount. The store replaces `DashboardGrid`'s internal `useState`.
- **Consumption:** Both `DashboardGrid` and the panel edit page read/write via `useDashboardStore`.
- **Lifecycle:** The store persists across navigation within the dashboard. When the user navigates to a different dashboard ID, the store is re-initialized.

### File: `packages/app/src/data/dashboards/dashboard-store.ts`

## Routing

### New route file

```
packages/app/src/routes/_authenticated/_dashboard/dashboards.$dashboardId_.panel.$panelKey.tsx
```

The `_` after `$dashboardId` breaks TanStack Router's layout nesting, so the panel edit page renders as a standalone page (not inside the dashboard grid layout).

**URL:** `/dashboards/default/panel/requestRate`

**Loader:** The panel edit route must also prefetch the dashboard via `dashboardOptions(dashboardId)` in its loader. This ensures that on a full page refresh, the React Query cache is populated and the zustand store can be re-initialized from it. The edit page component checks the store first; if empty, it falls back to the React Query cache to initialize.

### Navigation flow

1. User clicks an **edit button** on a panel in the dashboard grid
2. Navigates to `/dashboards/:dashboardId/panel/:panelKey`
3. Panel edit page reads the panel from the zustand store
4. User edits query/viz options in a **local draft** (`useState` initialized from store)
5. **Apply** → commits draft to store via `updatePanel(key, draft)`, navigates back
6. **Discard** → navigates back without committing

## Page Layout

```
┌──────────────────────────────────────────────────────┐
│  ← Back to dashboard    Panel Title    [Discard] [Apply] │
├──────────────────────────────────────────────────────┤
│                                                      │
│                  Panel Preview                       │
│           (PanelShell + placeholder viz)             │
│                                                      │
├──────────────────────────────────────────────────────┤
│  [Query]  [Visualization]                            │
│ ──────────────────────────────────────────────────── │
│                                                      │
│  (Active tab content)                                │
│                                                      │
└──────────────────────────────────────────────────────┘
```

- **Top bar:** Back link (to `/dashboards/:dashboardId`), panel display name, Discard (ghost button) and Apply (primary button)
- **Preview section:** ~40% of viewport height. Renders `PanelShell` with the current draft panel data. Shows the plugin kind as placeholder content (same as current `DashboardPanel` behavior). Updates live as the user changes the draft.
- **Editor section:** ~60% of viewport height, scrollable. Uses the existing `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` from `@everr/ui/components/tabs`.

## Query Tab

- **SQL editor:** A monospace `<textarea>` for ClickHouse SQL
- **Data mapping:** `draft.spec.queries[0].spec.plugin.spec.query` (string)
- **Query plugin kind:** Hardcoded to `"ClickHouseSQL"` for this iteration
- **Run button:** Disabled placeholder button labeled "Run Query" — wired up in a future iteration
- If the panel has no queries array, one is created on first edit with an empty query string

## Visualization Tab

### Chart type picker

A segmented control (radio group styled as buttons) with three options:

| Kind | Label | Icon |
|------|-------|------|
| `TimeSeriesChart` | Time Series | LineChart icon |
| `StatChart` | Stat | Hash icon |
| `Table` | Table | Table icon |

Selecting a type updates `draft.spec.plugin.kind`. The `spec` object is preserved (no reset on type change).

### Display options

| Field | Component | Maps to |
|-------|-----------|---------|
| Title | `Input` | `draft.spec.display.name` |
| Description | `Textarea` | `draft.spec.display.description` |
| Unit | `Input` | `draft.spec.plugin.spec.unit` |
| Show legend | `Switch` | `draft.spec.plugin.spec.showLegend` |

The "Show legend" switch is only shown when `plugin.kind === "TimeSeriesChart"`.

## Components

### New files

| File | Purpose |
|------|---------|
| `data/dashboards/dashboard-store.ts` | Zustand store definition |
| `routes/.../dashboards.$dashboardId_.panel.$panelKey.tsx` | Route file |
| `components/dashboards/panel-edit-page.tsx` | Main edit page layout |
| `components/dashboards/panel-preview.tsx` | Preview section |
| `components/dashboards/query-editor.tsx` | ClickHouse SQL textarea |
| `components/dashboards/viz-options.tsx` | Chart type picker + display options |

### Modified files

| File | Change |
|------|--------|
| `routes/.../dashboards.$dashboardId.tsx` | Initialize zustand store from React Query data |
| `components/dashboards/dashboard-grid.tsx` | Replace `useState(initial)` with zustand store consumption |
| `components/dashboards/dashboard-panel.tsx` | Add edit button/link that navigates to the panel edit route |

### Reused components

- `PanelShell` — panel chrome for the preview
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` — tabbed editor
- `Button`, `Input`, `Textarea`, `Label` — form elements
- `Link` from TanStack Router — back navigation

## Verification

1. **Navigation:** Click edit on a panel in the grid → lands on `/dashboards/:id/panel/:key` with correct panel data displayed
2. **Preview updates:** Change the title in viz options → preview header updates in real-time
3. **Query editing:** Type SQL in the query tab → draft stores the value
4. **Chart type:** Switch between TimeSeriesChart/StatChart/Table → preview reflects the kind label, conditional options (legend) show/hide correctly
5. **Apply:** Click Apply → navigates back to dashboard, panel reflects the changes
6. **Discard:** Click Discard → navigates back, panel is unchanged
7. **Refresh resilience:** Refresh the edit page → store re-initializes from React Query cache, panel data is preserved
8. **Run dev server** and walk through the full flow in the browser
