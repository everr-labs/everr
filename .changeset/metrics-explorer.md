---
"@everr/app": minor
"@everr/cli": minor
---

Explore has a new **Metrics** page, in Everr and in the local explorer opened by `everr local start`. In Everr it's listed first in the Explore sidebar, followed by Logs, Traces and Errors.

- **Catalog:** lists every metric your services send in the time range, with its type, unit, data point count and when it last reported. Search by name or filter by type.
- **Charts:** open a metric to chart it.
  - Gauges show avg, min, max or sum.
  - Counters show a per-second rate or the increase per interval, and cumulative counters stay correct across process restarts.
  - UpDownCounters show the sum across series.
  - Histograms show p50, p95 or p99 (worked out from bucket counts), the average or the observation rate, plus a heatmap of observations per bucket over time.
  - Exponential histograms chart the same way as histograms, and stay exact when an SDK changes their scale.
  - Summaries chart the quantiles your SDK reports, the average and the rate. An SDK computes a summary's quantiles per instance, so a line that covers several instances shows the highest of them. Group by instance to see each one.
- **Mixed bucket bounds:** when the series in one line report different bucket bounds, for example two services on different SDK versions, they're combined on one set of bounds. A note says whether the percentiles are exact or estimated.
- **Exemplars:** when your SDK records exemplars, the chart marks the slowest sampled request in each interval with a diamond. Click one to open its trace or its logs.
- **Resolution:** a chart is never finer than how often the metric is exported, so a metric sent every 15 minutes draws a line rather than scattered points. The header shows the chart's resolution.
- **Several queries:** add up to three more metrics to the same chart, each with its own aggregation, grouping and filters. Hide any of them without losing its setup, or click a metric's name to switch it to another.
- **Reloading:** a chart stays on screen while it reloads, and dims if the reload takes more than a moment. A query you didn't change keeps its data, so adding a copy of a query or editing one of several doesn't reload the others. Their latest interval can hold slightly less data than the query you changed, and refreshing brings every query up to date.
- **Grouping and zoom:** group the chart by up to three attributes, filter by attribute values, and drag across the chart to zoom. As on dashboards, each zoom adds a history entry, so Back returns to the previous range.
- **Filters:** Service and Environment carry over from the other Explore pages. Their menus on every Explore page now include services and environments that send only metrics.
