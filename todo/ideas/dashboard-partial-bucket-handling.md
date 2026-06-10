# Dashboard partial edge-bucket handling

## What
Give time-series panels a way to handle the partial first/last buckets that
`toStartOfInterval(col, INTERVAL {step} SECOND)` produces. The picker's `from`/
`to` rarely land on a bucket boundary, so the leading bucket starts before
`from` and the trailing bucket ends before a full `step` elapses. Today both
are shown (leading clipped at the axis edge, trailing rendered as-is), which
for a cumulative metric reads as a misleading dip at the right edge.

Leading candidate: a per-panel `trimIncompleteBuckets` flag on the
TimeSeriesChart plugin spec (default `false` = show), alongside `connectNulls`/
`curveType`. When set, drop the leading and trailing buckets that don't cover a
full interval.

## Why
A partial trailing bucket undercounts `count()`/`sum()` series and looks like a
regression. But we run arbitrary user SQL and can't infer the aggregation's
semantics: for an instantaneous metric (`avg`, `quantile`, a gauge) the partial
bucket is *correct* — it's just a shorter window — and dropping it would hide
the most recent value, usually the point the user cares about most. So no global
behavior is right for every panel; the author has to decide per metric. A
documented callout currently covers the dip (see panels-and-visualizations.mdx
"Adaptive bucketing").

## Who
Dashboard authors writing as-code panels, especially count/rate panels where the
trailing dip is misleading.

## Rough appetite
small–medium

## Notes
- Detectable entirely client-side, no server change: the chart already infers
  the interval (`detectInterval` in `time-series-chart/time-series-data.ts`). A
  trailing bucket is partial iff `lastTs + interval > to`; leading iff
  `firstTs < from`. An exactly-aligned range correctly keeps its last bucket.
- Default should be **show** (`trimIncompleteBuckets: false`): never silently
  hide data — a gauge dashboard quietly missing "now" is the worst failure mode.
  Authors of cumulative-count panels opt in.
- Grafana parallel: it only auto-aligns/drops for its **Prometheus** datasource
  (query range snapped to step). For **SQL** sources (`$__timeGroup`, our
  ClickHouse-bucketed case) it shows the partial bucket — so "show" already
  matches Grafana-for-SQL.
- Richer alternative (more work, deferred): instead of dropping, visually mark
  the partial leading/trailing segments (dashed/faded) so they're honest and
  non-misleading without hiding data. Fiddly to render a single end segment in
  recharts.
- Context: came out of the PR #198 review (adaptive `{step}` bucketing).
