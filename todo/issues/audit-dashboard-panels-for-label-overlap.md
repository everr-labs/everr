---
What: Audit all dashboard visualizations for the long-label overlap / tooltip-drift class of bugs fixed on the bar chart
Where: packages/app/src/components/dashboards/visualizations/* (per-viz renderers)
Priority: low
---

## What

The bar chart had two issues that were fixed in #247: long category-axis labels (e.g. URL paths) rendered at full width and overlapped, and its tooltip still used recharts' built-in `Tooltip` instead of the shared cursor-following `CursorTooltip` portal the other charts use. Both are likely shared by other visualizations — sweep every panel type for the same class of bug.

## Checklist

For each visualization in `packages/app/src/components/dashboards/visualizations/`:

- **Axis label overlap** — anything with a category axis rendering string labels (table, heatmap, state-timeline, status-history, etc.). Long values should truncate to their band (middle ellipsis, full value on hover) rather than overlap. Compare against the bar chart's `CategoryTick`.
- **Tooltip consistency** — confirm each chart uses the shared `CursorTooltip` + `SeriesTooltipContent` (same card chrome, cursor-following, viewport-edge flip). Flag any still using recharts' built-in `Tooltip` or bespoke tooltip markup.

## Notes

- Reference fix: bar chart `bar-chart-visualization.tsx` (PR #247) — `CategoryTick` for truncation, `CursorTooltip` for the tooltip.
- The viz gallery (`everr/viz-gallery/*.dashboard.yaml`) is the place to reproduce/verify each panel with deterministic TestData; add long-label cases where missing.
