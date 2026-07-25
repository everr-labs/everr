# Two parallel chart-tooltip systems (content + container)

## What
Chart tooltips are built two incompatible ways across the app: recharts' `ChartTooltip`/`ChartTooltipContent` (fed by `createChartTooltipFormatter`) versus a portaled `CursorTooltip` + chrome-free `SeriesTooltipContent`. They render the same swatch/label/value idea twice; consolidate on one.

## Where
- **System A (recharts-native):** `@everr/ui/components/chart` `ChartTooltip` + `ChartTooltipContent`, with rows built by `createChartTooltipFormatter` / `createChartTooltipLabelFormatter` (`packages/ui/src/components/chart-helpers.tsx`). Used by the repo/test trend charts: `repo-success-rate-chart.tsx`, `repo-duration-trend-chart.tsx`, `test-duration-trend-chart.tsx`. It renders recharts' default tooltip: a card anchored to the plot, not the cursor.
- **System B (portaled, cursor-following):** `@/components/cursor-tooltip` `CursorTooltip` (card chrome + viewport-edge-flipping positioning) wrapping `SeriesTooltipContent` (`packages/app/src/components/dashboards/visualizations/series-tooltip.tsx`, a chrome-free swatch/label/value grid). Used by every dashboard visualization (time-series, bar, treemap, ...) and now the SLO budget chart (`packages/app/src/components/cc/slo-budget-chart.tsx`).

## Why it matters
Two behaviors for the same UI element: the trend charts get recharts' anchored card, the dashboard + SLO charts get a cursor-following portaled card. New charts pick one at random, and a change to "how tooltips look/behave" has to be made in two places. The container (`CursorTooltip`) and content (`SeriesTooltipContent`) are already reusable and now shared by the dashboard and SLO surfaces; the gap is the trend charts still on System A.

`SeriesTooltipContent` also lives under `dashboards/visualizations/` while being used from `components/cc/`. If it becomes the shared content primitive it should move somewhere neutral (alongside `cursor-tooltip.tsx` at `components/`), so a cc/SLO chart doesn't reach into the dashboards feature for it.

## Sketch
- Migrate the three trend charts from `ChartTooltip`/`ChartTooltipContent` to `CursorTooltip` + `SeriesTooltipContent`, driven by recharts' `onMouseMove` active-index state (the pattern the SLO chart now uses: `state.activeTooltipIndex` + the native event's `clientX/clientY`).
- Once nothing uses them, retire `ChartTooltipContent` + `createChartTooltipFormatter` (keep `createChartTooltipLabelFormatter` only if a title formatter is still wanted).
- Move `SeriesTooltipContent` out of `dashboards/visualizations/` to a shared location and update imports.

## Related
Surfaced while giving the SLO budget chart (`slo-budget-chart.tsx`) the dashboard tooltip's behavior by reusing `CursorTooltip` + `SeriesTooltipContent`.
