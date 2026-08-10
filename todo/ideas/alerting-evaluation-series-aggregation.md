# Aggregate the evaluation series in ClickHouse

The rule-detail chart currently fetches raw evaluation rows (with
`samples_json`) for the window, capped at `EVALUATION_SERIES_ROW_CAP`
newest rows, and downsamples in the server (`shapeAlertEvaluationSeries`,
required set gridded to the display budget when a whole-window incident
makes every point required).

The principled endpoint is to aggregate in ClickHouse instead: bucket the
window to the display budget in SQL (`toStartOfInterval` sized from the
window and target points) and select one representative row per bucket
with `argMax`, prioritizing failed over breaching over ok so the bucket
representative is the point that matters. Transfer is then bounded at the
display budget regardless of window size, and the row cap disappears.

Costs that kept it out of the fix:

- Bucket representative selection changes what "a point" means: samples
  and evidence belong to one real evaluation, so the bucket must carry
  one row's `samples_json` verbatim (`argMax`), never a merge.
- The `recent_points` strip wants the raw newest 25 rows, so it becomes a
  second (cheap) query or a `UNION`.
- State-transition fidelity: a bucket can swallow a one-evaluation
  recovery between two breaching neighbors. Acceptable at display
  resolution, but it should be a stated property, not an accident.
