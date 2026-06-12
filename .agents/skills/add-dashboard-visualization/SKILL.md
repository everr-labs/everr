---
name: add-dashboard-visualization
description: Use when adding a new visualization type (chart, table, stat, gauge, etc.) to the dashboard panel system, or adding options to an existing one. Guides creating the spec schema, the read-only renderer component, registering both, and keeping the viz-gallery dashboard exhaustive.
user-invocable: true
---

# Adding a Dashboard Visualization

Follow these steps to add a new visualization type to the dashboard panel system.

Dashboards are **read-only**: they are defined as code (Perses YAML/JSON in a source repo) and reconciled into Everr with `everr apply`. There is no in-app editor or chart-type picker. A visualization is therefore a **pure renderer** — it takes its parsed spec options plus the query results and draws them. Selecting a visualization for a panel happens in the dashboard file (`plugin.kind`), not in the UI.

## Architecture

Visualizations live in `packages/app/src/components/dashboards/visualizations/`. Each type gets its own subdirectory with a renderer and a zod spec schema:

```
visualizations/
├── index.tsx                          # Registry — maps plugin.kind to { schema, component, inset }
├── parse-spec.ts                      # Lenient spec parsing (invalid options → defaults + warnings)
├── table/
│   ├── spec.ts                        # Zod schema for the plugin's options
│   └── table-visualization.tsx        # Renders the visualization
└── <your-new-type>/
    ├── spec.ts
    └── <type>-visualization.tsx
```

The schema is used twice: `everr apply` validates dashboard files against it (strict, via `data/dashboards/plugin-specs.ts`), and at render time the raw spec is parsed leniently — invalid options fall back to their defaults and surface as a warning icon in the panel header.

## Key interfaces

The visualization component receives its **parsed spec** (the output of its schema — defaulted and typed, never the raw plugin config) and the results of running the panel's queries:

```ts
// From visualizations/index.tsx
interface VisualizationProps<TSpec = unknown> {
  spec: TSpec;                // parsed output of the visualization's spec schema
  data?: QueryResultRow[][];  // one frame (row[]) per panel query; undefined while loading
  timeRange?: ResolvedTimeRange;                 // { from: Date; to: Date }
  onTimeRangeChange?: (range: ResolvedTimeRange) => void; // e.g. drag-to-zoom
}
```

`data` is an array of query frames — one entry per query on the panel, each a
list of rows. Loading, error, and empty states are handled by the panel shell
and by the renderer's own `!data` branch.

## Steps

### 1. Create the visualization directory

```
packages/app/src/components/dashboards/visualizations/<kind>/
```

Use the lowercase kebab-case of the `kind` value (e.g., `TimeSeriesChart` → `time-series-chart/`).

### 2. Define the spec schema

File: `<kind>/spec.ts` — pure zod, **no React imports** (it is loaded from server code).

```ts
import * as z from "zod";

export const <kind>Spec = z.looseObject({
  showLegend: z.boolean().default(false),
  unit: z.string().default(""),
});

export type <Kind>Spec = z.infer<typeof <kind>Spec>;
```

Two contracts to respect:

- **`looseObject`, never `object`/`strictObject`** — unknown option keys must flow through verbatim (validation is never stricter than Perses on shape).
- **`{}` must parse** — every known field needs `.default(...)` or `.optional()`. The lenient render path relies on this to fall back to defaults when an option is invalid.

### 3. Create the visualization component

File: `<kind>/<kind>-visualization.tsx`

```tsx
import type { VisualizationProps } from "../index";
import type { <Kind>Spec } from "./spec";

export function <Kind>Visualization({
  spec,
  data,
}: VisualizationProps<<Kind>Spec>) {
  // Options are already validated and defaulted — read them directly
  // (e.g. spec.showLegend), no typeof narrowing or casts.
  // Render `data` (one frame per panel query); render an empty state when !data
}
```

- Render the query results passed in `data`; handle the `!data` / empty cases
- Available chart library: **Recharts** (Bar, Line, Area, ComposedChart, ScatterChart, etc.)
- Available chart wrapper: `ChartContainer` from `@everr/ui/components/chart`
- Available table: `DataTable` from `@everr/ui/components/data-table`

**Hover tooltips use the shared `CursorTooltip`** (`@/components/cursor-tooltip`) —
do not hand-roll positioning or use recharts' `<Tooltip>` (it anchors at the
shape's center, not the cursor). `CursorTooltip` is a portaled card that follows
the pointer and flips at viewport edges instead of clipping; you provide the
content, it provides the card chrome and positioning. Track hover yourself and
render it conditionally:

```tsx
const [hover, setHover] = useState<{ datum: D; x: number; y: number } | null>(null);
// on each shape: onMouseEnter={(e) => setHover({ datum, x: e.clientX, y: e.clientY })}
//                onMouseLeave={() => setHover(null)}
// on the chart container, keep the position tracking the pointer:
//                onMouseMove={(e) => setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
{hover && (
  <CursorTooltip x={hover.x} y={hover.y}>
    {/* time-series-style content: muted header, then swatch · label · tabular-nums value */}
  </CursorTooltip>
)}
```

The TimeSeriesChart, GeoMap, and Treemap visualizations all use it — match
their tooltip content structure for visual consistency.

**Scrolling and overflow are visualization concerns.** `PanelShell` provides `min-h-0 flex-1` on its content area but no `overflow`. Each visualization must manage its own scroll container. For example, the table visualization wraps itself in a flex column with a scrollable inner div:

```tsx
<div className="flex h-full flex-col">
  <div className="min-h-0 flex-1 overflow-auto">
    {/* visualization content */}
  </div>
</div>
```

Never add `overscroll-none` to these containers: an `overflow:auto` element is a scroll container even when its content fits, and `overscroll-behavior: none` then swallows wheel events instead of chaining them — making the dashboard unscrollable while the cursor is over the panel.

For `flush-content` visualizations that need a top border separating the header from content, place `border-t border-border` on the outer wrapper — outside the scroll container so it stays fixed:

```tsx
<div className="flex h-full flex-col border-t border-border">
  <div className="min-h-0 flex-1 overflow-auto">
    {/* content */}
  </div>
</div>
```

### 4. Register the visualization

In `packages/app/src/components/dashboards/visualizations/index.tsx`, import the component and its schema, then add a `defineVisualization` entry to the `registry` object — it type-checks that the component's props match the schema's output:

```tsx
import { <kind>Spec } from "./<kind>/spec";
import { <Kind>Visualization } from "./<kind>/<kind>-visualization";

const registry: Record<string, VisualizationEntry> = {
  // ... existing entries
  <Kind>: defineVisualization({
    schema: <kind>Spec,
    component: <Kind>Visualization,
    inset: "default",               // or "flush-content" for edge-to-edge content like tables
  }),
};
```

The `inset` option controls padding inside the panel card:
- `"default"` — standard padding (use for charts, stats)
- `"flush-content"` — no horizontal padding or bottom padding (use for tables, maps)

### 5. Register the schema for apply-time validation

In `packages/app/src/data/dashboards/plugin-specs.ts`, add the schema under the plugin kind:

```ts
export const panelPluginSpecs: Record<string, z.ZodType> = {
  // ... existing entries
  <Kind>: <kind>Spec,
};
```

Without this, `everr apply` accepts any spec for the new kind instead of rejecting invalid option values with the file and option path. There is a test asserting every registered schema parses `{}` (`visualizations/parse-spec.test.ts`).

### 6. Document the options

Add the new kind and its option table to `packages/docs/content/docs/dashboards/visualizations.mdx`, and update the `everr-write-dashboards` skill in `crates/everr-core/assets/skills/` so dashboard-authoring agents know the options exist.

### 7. Add it to the gallery dashboard

The `dashboards/viz-gallery/` directory (project `demo`) is the visual regression sheet, split by visualization type into one dashboard per kind — `time-series.yaml`, `stat.yaml`, `table.yaml`, and `geo-map.yaml`. Together they must exercise **every visualization kind with every spec option** — including each enum value — and every meaningful data-shape behavior (multi-query, grouped pivot, no time column, empty/no-data states) at least once. This step applies to ANY spec change, not just new kinds: when you add an option (or enum value) to an existing visualization, add or extend a panel in the matching per-type file that exercises it.

The gallery's panels are driven by the **`TestData`** query kind (a deterministic,
ClickHouse-free dev data source), not real telemetry — so the sheet renders
identical output every time. When you add an option that needs specific data to be
visible, drive the new panel with a `TestData` scenario (`random_walk` for time
series/stats, `table` for tabular data, `csv` for exact small frames) rather than a
`ClickHouseSQL` query. See the TestData section in
`packages/docs/content/docs/dashboards/panels-and-visualizations.mdx` for the
scenario options.

- One panel per meaningful option combination; put the options it exercises in the panel's `display.description` (e.g. `"curveType: stepAfter · unit: ms"`).
- Reference each new panel from the layout grid at the bottom of the same per-type file.
- Reconcile and eyeball it: `everr apply ./dashboards`, then open `/dashboards/demo/viz-gallery-time-series` (or `-stat` / `-table` / `-geo-map`).

### 8. Use it in a dashboard

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
          kind: <Kind>            # matches the registry key from step 4
          spec: { showLegend: true }   # validated against the spec schema from step 2
        queries:
          - kind: ClickHouseSQL
            spec:
              plugin: { kind: ClickHouseSQL, spec: { query: "SELECT ..." } }
```

Reference the panel from a layout item in the same dashboard, then reconcile it:

```bash
everr apply ./dashboards --dry-run   # preview the diff
everr apply ./dashboards             # write it
```

The dashboard's project comes from `metadata.project` (default `"default"`).
Open `/dashboards/<project>/<slug>` to see it render with live query results.

## Reference: Table visualization

The Table visualization is a complete example:

- **Spec schema:** `visualizations/table/spec.ts` — `stickyHeader` boolean, defaulted
- **Visualization:** `visualizations/table/table-visualization.tsx` — uses `DataTable` from `@everr/ui`, renders the `data` frames, reads `spec.stickyHeader`
- **Registry:** `inset: "flush-content"` so the table sits edge-to-edge in the panel
