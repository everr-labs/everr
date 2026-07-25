# TODO

## Issues

- [**chart-tooltip-content-duplication**](todo/issues/chart-tooltip-content-duplication.md) — Chart tooltips are built two incompatible ways across the app: recharts' `ChartTooltip`/`ChartTooltipContent` (fed by `createChartTooltipFormatter`) versus a portaled `CursorTooltip` + chrome-free `SeriesTooltipContent`. They render the same swatch/label/value idea twice; consolidate on one.
- [**slo-sli-query-ingestion-delay**](todo/issues/slo-sli-query-ingestion-delay.md) — SLI queries end their windows at `now()`, so every window includes a trailing slice whose rows have not landed yet (measured: 2-9s, but ~13% of a floored 60s short window). Shift `window_end` back by an ingestion-delay allowance; the file also records the larger question of a 60s short window being below the resolution of sparse telemetry.

## Ideas

- [**slo-sli-rollups**](todo/ideas/slo-sli-rollups.md) — Pre-aggregate simple `countIf`-style SLIs into time-bucketed rollups so budget and burn-rate windows read pre-summed buckets instead of rescanning raw telemetry each evaluation, letting us drop (or relax) the `/12` refresh throttle for those SLOs.

