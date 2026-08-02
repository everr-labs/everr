# SLO budget chart: alert markers snap to the series grid, tooltip reports the snapped time

## What
On the SLO detail page, the budget history chart overlays alert transitions (tier fired / resolved) as vertical markers. Each marker is snapped to the nearest plotted budget instant rather than drawn at the event's real timestamp, and the marker's hover tooltip titles itself with the snapped instant, not the event's actual time.

## Where
`packages/app/src/components/cc/slo-budget-chart.tsx`:
- The budget series is computed on a fixed instant grid, and the recharts `XAxis` is categorical (`dataKey="t"`, no `type="number"`), so a `ReferenceLine` can only be placed on an existing plotted instant.
- `snapToPoint` therefore maps each event timestamp to the nearest grid point before drawing; events outside the plotted range are dropped.
- The snapping is also load-bearing: same-type events landing on one tick are deduped into a single bar (`eventMarks`), and hover hit-targets are keyed per instant (`markerHits`).
- The marker tooltip (`MarkerTip`) carries only the snapped `t`, which becomes the tooltip title.

## Why it matters
- Horizontal imprecision of up to half a grid step (a tier that fired at 14:37 renders on the 14:40 point). Tolerable in itself: the budget line only has grid resolution anyway.
- The tooltip reporting the snapped time is the genuinely misleading part: it asserts a precise timestamp that is not when the transition happened, on the one surface (hover) where the reader is asking for precision.

## Sketch
1. Cheap, independent: carry the original event timestamps into `MarkerTip` so the bar stays snapped but the tooltip reports the real time(s) of each transition behind it.
2. Larger, only if exact placement ever matters: switch the X axis to a numeric time scale (epoch ms + domain), which lets `ReferenceLine` sit at any x and removes `snapToPoint`, at the cost of reworking tick generation and the index-based hover/tooltip logic shared with the dashboard charts.

## Related
Surfaced while reviewing the triage board redesign; the markers themselves were added with the budget history panel on the SLO detail page.
