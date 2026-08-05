# The SLO budget chart rebuilds its whole model on every pointer move

From the PR #225 review; see [pr-225-review-findings.md](./pr-225-review-findings.md),
finding 16.

## What
`SloBudgetChart` computes its entire render model in the component body with no
memoization, and `setHover` fires from recharts' `onMouseMove`. So every pointer
movement re-runs the full model build and hands recharts a new `data` array
identity, forcing it to recompute every line path and reference line.

The sibling dashboard chart memoizes exactly this. The SLO chart is the one place
on the branch that skips the discipline the rest of the chart code follows.

## Where
`packages/app/src/components/cc/slo-budget-chart.tsx`:

- `:255-395`: the model build, all in the render body. In order: `ranked`
  the `data` model, `snapToPoint` per event, then `eventMarks`
  and `markerHits`.
- `:455-460`: `onMouseMove` reads `state.activeTooltipIndex` and calls `setHover`
  with the viewport coordinates the portaled tooltip needs.

The comparison:
`packages/app/src/components/dashboards/visualizations/time-series-chart/time-series-chart-visualization.tsx:84-125`
builds the same shape of model inside `useMemo` with correct dependency arrays.

## Cost per pointer move
For an SLO at the chart's own limits (200 instants and 200 events):

- `data` projection: 200 instants x 2 keys.
- `snapToPoint`: O(events x instants), so 200 x 200 is about 40k operations.
- New `data` array identity, so recharts recomputes two `<Line>` paths (observed
  and reconstructed) plus up to about 400 `ReferenceLine`
  elements.

All of that between one mouse event and the next. The user-visible symptom is the
hover readout lagging behind the cursor when many transition markers are present.

## Why it is filed rather than fixed
The mechanical fix (wrap the model in `useMemo`) is easy, but doing it correctly
means splitting hover-dependent work from hover-independent work, and right now
they are interleaved in one straight-line body. `eventMarks` and `markerHits`
depend on the geometry but not on which point is hovered; the tooltip content does
depend on hover. Wrapping the whole thing in a single `useMemo` keyed on hover
would preserve the bug while looking fixed.

So it wants a deliberate pass over which values are hover-derived, not a wrapper.

## Sketch
- Split into two memos: the geometry model (series, marks, hit
  targets) keyed on the data and dimensions only, and the hover-derived values
  keyed on the hover index.
- Keep the `data` array identity stable across hover changes. That alone removes
  most of the cost, since it is what makes recharts recompute paths.
- Move `snapToPoint` out of the per-render path: event-to-instant snapping depends
  only on the events and the instant grid, so it can be computed once with the
  geometry model.
- Consider throttling `setHover` to animation frames if lag persists after
  memoizing, but measure first: the array identity is the likely dominant cost.
- Follow `time-series-chart-visualization.tsx:84-125` for the dependency-array
  shape rather than inventing a second convention.

## Related
- `todo/issues/chart-tooltip-content-duplication.md` covers the two parallel
  tooltip systems this chart sits between.
