---
name: add-dashboard-visualization
description: Use when adding a new visualization type (chart, table, stat, gauge, etc.) to the dashboard panel system. Guides creating the visualization component, settings, registry entry, and chart type picker entry.
user-invocable: true
---

# Adding a Dashboard Visualization

Follow these steps to add a new visualization type to the dashboard panel system.

## Architecture

Visualizations live in `packages/app/src/components/dashboards/visualizations/`. Each type gets its own subdirectory with two files:

```
visualizations/
├── index.tsx                          # Registry — maps plugin.kind to components
├── table/
│   ├── table-visualization.tsx        # Renders the visualization
│   └── table-settings.tsx             # Settings UI for the viz options panel
└── <your-new-type>/
    ├── <type>-visualization.tsx
    └── <type>-settings.tsx            # Optional — only if the type has settings
```

## Key interfaces

The visualization component receives the full `PanelPlugin` object:

```ts
// From visualizations/index.tsx
interface VisualizationProps {
  plugin: PanelPlugin;  // { kind: string; spec: Record<string, PluginSpecValue> }
}
```

Settings are read from and written to `plugin.spec`:

```ts
// From visualizations/index.tsx
interface VisualizationSettingsProps {
  spec: Record<string, unknown>;
  onChange: (spec: Record<string, unknown>) => void;
}
```

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

export function <Kind>Visualization({ plugin }: VisualizationProps) {
  // Read settings from plugin.spec
  // Render the visualization
}
```

- Read visualization-specific options from `plugin.spec` (e.g., `plugin.spec.showLegend`)
- Use mock data for now — query execution is not wired up yet
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

### 3. Create the settings component (optional)

File: `<kind>-settings.tsx`

```tsx
import { Label } from "@everr/ui/components/label";
import type { VisualizationSettingsProps } from "../index";

export function <Kind>Settings({ spec, onChange }: VisualizationSettingsProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label>Setting Name</Label>
      {/* Use Input, ToggleGroup, Select, etc. from @everr/ui/components/ */}
    </div>
  );
}
```

Settings are stored in `plugin.spec` as key-value pairs. Read with `spec.myOption`, write with `onChange({ ...spec, myOption: value })`.

Available form components from `@everr/ui/components/`:
- `Input` — text/number inputs
- `Textarea` — multiline text
- `Label` — form labels
- `ToggleGroup` + `ToggleGroupItem` — segmented toggles (API: `value={string[]}`, `onValueChange={(next: string[]) => ...}`)
- `Select` — dropdowns

### 4. Register the visualization

In `packages/app/src/components/dashboards/visualizations/index.tsx`:

1. Import the components:
   ```tsx
   import { <Kind>Settings } from "./<kind>/<kind>-settings";
   import { <Kind>Visualization } from "./<kind>/<kind>-visualization";
   ```

2. Add an entry to the `registry` object:
   ```tsx
   const registry: Record<string, VisualizationEntry> = {
     // ... existing entries
     <Kind>: {
       component: <Kind>Visualization,
       settings: <Kind>Settings,       // omit if no settings
       inset: "default",               // or "flush-content" for edge-to-edge content like tables
     },
   };
   ```

The `inset` option controls padding inside the panel card:
- `"default"` — standard padding (use for charts, stats)
- `"flush-content"` — no horizontal padding or bottom padding (use for tables, maps)

### 5. Add to the chart type picker

In `packages/app/src/components/dashboards/viz-options.tsx`, add an entry to the `CHART_TYPES` array:

```tsx
import { <IconName> } from "lucide-react";

const CHART_TYPES = [
  // ... existing entries
  { kind: "<Kind>", label: "<Display Label>", icon: <IconName> },
] as const;
```

Pick an icon from `lucide-react` that represents the visualization type.

### 6. Add to mock dashboard (optional)

If you want the new visualization to appear on the default dashboard, add a panel entry in `packages/app/src/data/dashboards/mock.ts`:

```tsx
panels: {
  // ... existing panels
  myNewPanel: {
    kind: "Panel",
    spec: {
      display: { name: "Panel Title", description: "Optional description" },
      plugin: { kind: "<Kind>", spec: { /* default settings */ } },
    },
  },
},
```

And add a corresponding grid layout item in `layouts[0].spec.items`.

## Reference: Table visualization

The Table visualization is a complete example:

- **Visualization:** `visualizations/table/table-visualization.tsx` — uses `DataTable` from `@everr/ui`, reads `plugin.spec.stickyHeader`
- **Settings:** `visualizations/table/table-settings.tsx` — "Sticky header" toggle writing to `spec.stickyHeader`
- **Registry:** `inset: "flush-content"` so the table sits edge-to-edge in the panel
- **Chart type picker:** `{ kind: "Table", label: "Table", icon: Table }`
