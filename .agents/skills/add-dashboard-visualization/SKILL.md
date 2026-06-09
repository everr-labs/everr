---
name: add-dashboard-visualization
description: Use when adding a new visualization type (chart, table, stat, gauge, etc.) to the dashboard panel system. Guides creating the read-only renderer component and registering it.
user-invocable: true
---

# Adding a Dashboard Visualization

Follow these steps to add a new visualization type to the dashboard panel system.

Dashboards are **read-only**: they are defined as code (Perses YAML/JSON in a source repo) and reconciled into Everr with `everr apply`. There is no in-app editor or chart-type picker. A visualization is therefore a **pure renderer** — it takes a panel's `plugin` config plus the query results and draws them. Selecting a visualization for a panel happens in the dashboard file (`plugin.kind`), not in the UI.

## Architecture

Visualizations live in `packages/app/src/components/dashboards/visualizations/`. Each type gets its own subdirectory:

```
visualizations/
├── index.tsx                          # Registry — maps plugin.kind to components
├── table/
│   └── table-visualization.tsx        # Renders the visualization
└── <your-new-type>/
    └── <type>-visualization.tsx
```

## Key interfaces

The visualization component receives the panel's `plugin` config and the
results of running the panel's queries:

```ts
// From visualizations/index.tsx
interface VisualizationProps {
  plugin: PanelPlugin;        // { kind: string; spec: Record<string, PluginSpecValue> }
  data?: QueryResultRow[][];  // one frame (row[]) per panel query; undefined while loading
  timeRange?: ResolvedTimeRange;                 // { from: Date; to: Date }
  onTimeRangeChange?: (range: ResolvedTimeRange) => void; // e.g. drag-to-zoom
}
```

`data` is an array of query frames — one entry per query on the panel, each a
list of rows. Display options come from `plugin.spec`. Loading, error, and empty
states are handled by the panel shell and by the renderer's own `!data` branch.

## Steps

### 1. Create the visualization directory

```
packages/app/src/components/dashboards/visualizations/<kind>/
```

Use the lowercase kebab-case of the `kind` value (e.g., `TimeSeriesChart` → `time-series-chart/`).

### 2. Create the visualization component

File: `<kind>-visualization.tsx`

```tsx
import type { VisualizationProps } from "../index";

export function <Kind>Visualization({ plugin, data }: VisualizationProps) {
  // Read display options from plugin.spec (e.g. plugin.spec.showLegend)
  // Render `data` (one frame per panel query); render an empty state when !data
}
```

- Read display options from `plugin.spec` (e.g., `plugin.spec.showLegend`)
- Render the query results passed in `data`; handle the `!data` / empty cases
- Available chart library: **Recharts** (Bar, Line, Area, ComposedChart, ScatterChart, etc.)
- Available chart wrapper: `ChartContainer` from `@everr/ui/components/chart`
- Available table: `DataTable` from `@everr/ui/components/data-table`

**Scrolling and overflow are visualization concerns.** `PanelShell` provides `min-h-0 flex-1` on its content area but no `overflow`. Each visualization must manage its own scroll container. For example, the table visualization wraps itself in a flex column with a scrollable inner div:

```tsx
export function MyVisualization({ plugin }: VisualizationProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto overscroll-none">
        {/* visualization content */}
      </div>
    </div>
  );
}
```

For `flush-content` visualizations that need a top border separating the header from content, place `border-t border-border` on the outer wrapper — outside the scroll container so it stays fixed:

```tsx
<div className="flex h-full flex-col border-t border-border">
  <div className="min-h-0 flex-1 overflow-auto overscroll-none">
    {/* content */}
  </div>
</div>
```

### 3. Register the visualization

In `packages/app/src/components/dashboards/visualizations/index.tsx`:

1. Import the component:
   ```tsx
   import { <Kind>Visualization } from "./<kind>/<kind>-visualization";
   ```

2. Add an entry to the `registry` object:
   ```tsx
   const registry: Record<string, VisualizationEntry> = {
     // ... existing entries
     <Kind>: {
       component: <Kind>Visualization,
       inset: "default",               // or "flush-content" for edge-to-edge content like tables
     },
   };
   ```

The `inset` option controls padding inside the panel card:
- `"default"` — standard padding (use for charts, stats)
- `"flush-content"` — no horizontal padding or bottom padding (use for tables, maps)

### 4. Use it in a dashboard

There is no UI picker — a panel selects this visualization by setting
`plugin.kind` in a dashboard file. Add a panel to a Perses dashboard
(`.yaml`/`.json`) in a source repo:

```yaml
spec:
  panels:
    myNewPanel:
      kind: Panel
      spec:
        display: { name: Panel Title, description: Optional description }
        plugin:
          kind: <Kind>            # matches the registry key from step 3
          spec: { showLegend: true }   # whatever your renderer reads from plugin.spec
        queries:
          - kind: ClickHouseSQL
            spec:
              plugin: { kind: ClickHouseSQL, spec: { query: "SELECT ..." } }
```

Reference the panel from a layout item in the same dashboard, then reconcile it:

```bash
everr apply ./dashboards --source=<source> --dry-run   # preview the diff
everr apply ./dashboards --source=<source>             # write it
```

Open `/dashboards/<source>/<slug>` to see it render with live query results.

## Reference: Table visualization

The Table visualization is a complete example:

- **Visualization:** `visualizations/table/table-visualization.tsx` — uses `DataTable` from `@everr/ui`, renders the `data` frames, reads `plugin.spec.stickyHeader`
- **Registry:** `inset: "flush-content"` so the table sits edge-to-edge in the panel
