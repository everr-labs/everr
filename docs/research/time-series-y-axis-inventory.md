# Time series Y axis range controls

Research date: 2026-09-19. Scope: the value-axis range of time series charts, including zero and clipping behavior. This inventory uses first-party documentation and source. "Not documented" means the cited public model or page does not define the behavior, not that the product cannot do it.

| Product | Public controls and names | Default range and zero | Hard versus soft bounds |
| --- | --- | --- | --- |
| Grafana | UI: **Soft min**, **Soft max**, **Min**, **Max**, and **Centered zero**. | Axis range is based on the data by default, with padding. Centered zero defaults to off. | Soft values extend the automatic range without clipping data. Hard Min/Max can clip it. |
| Perses | `yAxis.min`, `yAxis.max`, `yAxis.logBase` (2 or 10). The editor labels the bounds **Min** and **Max**. | Both bounds default to unset. The exact automatic zero policy was not verified. | No `softMin` or `softMax` in the published TimeSeriesChart schema. Numeric min/max are axis bounds; no soft bound semantics are documented. |
| Datadog | UI: **Min**, **Max**, **Scale**, **Always include zero**. JSON: `yaxis.min`, `yaxis.max`, `yaxis.scale`, `yaxis.include_zero`, with `right_yaxis` for a second axis. | Min/max default to `"auto"`; scale defaults to `"linear"`; include zero defaults to `true`. | Min/max can clip the plotted range. No separately named soft min/max in the timeseries widget schema. |
| Dash0 | UI: **Min/Max** and **Scale**. Public TimeSeriesChart model: `yAxis.min`, `yAxis.max` (plus `show`, `label`, `format`, `maxDesiredDataPoints`, `showOnlyMaxScale`). | UI describes automatic, data based min/max as an alternative to fixed numbers. The exact zero policy is not documented. | UI describes fixed numbers. No soft min/max or include zero control appears in the published TimeSeriesChart model. |
| Kibana Lens | Y axis **Bounds** modes: **Full**, **Data**, **Custom**, plus **Round to nice value**. | The current line chart docs do not specify the default bounds mode or define each mode's zero behavior. | Custom sets bounds, but no separate soft numeric bounds are documented. |
| New Relic | Y axis **minimum** and **maximum** on line and area charts. | Defaults to zero through the top data value plus margin. | Explicit min/max restrict the displayed range; no soft bounds are documented. |
| Chronosphere | Y axis **Min** and **Max**. | Unset means a dynamic range that displays all data. Zero policy is not specified. | Explicit bounds clip values outside the range; no soft bounds are documented. |
| CloudWatch | Left and right Y axis **Min** and **Max**, JSON `yAxis.left.min/max` and `yAxis.right.min/max`. | Both bounds are optional and default to Auto. Zero policy is not specified. | Numeric bounds limit the displayed range; no soft bounds are documented. |
| Honeycomb | Per-chart **Linear Scale** or **Log Scale**. | Linear is the documented default. The chart settings page does not state the zero policy. | That page does not list numeric Y axis bounds or soft bounds. |

## Grafana

The [time series documentation](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/time-series/) lists **Soft min**, **Soft max**, and **Centered zero** under Axis options. It says the default Y range is automatic. Soft bounds can keep mostly flat data from occupying the entire plot, while standard **Min** and **Max** are hard limits that can clip spikes. Centered zero makes the range symmetric about zero; it is a different feature from including zero as one endpoint. The [time series default configuration](https://github.com/grafana/grafana/blob/main/public/app/plugins/panel/timeseries/config.ts) has `axisCenteredZero: false`. The [scale builder](https://github.com/grafana/grafana/blob/main/packages/grafana-ui/src/components/uPlot/config/UPlotScaleBuilder.ts) passes hard and soft bounds separately to uPlot with 10% default padding.

For positive data near 13k, Soft min 0 is the Grafana-style way to include zero while still permitting negative data to extend below it. For negative-only data, Soft max 0 includes zero at the top. Hard Min 0 would instead clip negative data. This is an inference from the documented soft and hard behavior.

## Kibana Lens

The current [line chart settings](https://www.elastic.co/docs/explore-analyze/visualize/charts/line-charts) put **Bounds** under the left axis with **Full**, **Data**, and **Custom** choices, plus **Round to nice value**. The page does not explain the three modes' exact domain algorithms or name a separate soft bound. The [Lens overview](https://www.elastic.co/docs/explore-analyze/visualize/lens) says line, bar, and area charts support configured bounds, and bar and area charts require zero within the lower and upper bounds. The older [TSVB documentation](https://www.elastic.co/docs/explore-analyze/visualize/legacy-editors/tsvb) says its time series include zero by default. TSVB and Lens are different editors, so TSVB's default should not be attributed to Lens.

## New Relic

The [chart customization documentation](https://docs.newrelic.com/docs/query-your-data/explore-query-data/use-charts/use-your-charts/) provides minimum and maximum values in the Y axis section for line and area charts. It explicitly says the default graph spans from zero to the top data value plus a margin. The documented controls do not distinguish soft bounds from hard ones.

## Chronosphere

The [time series chart documentation](https://docs.chronosphere.io/observe/dashboards/panels/time-series-chart) names Y axis **Min** and **Max**. Unset bounds dynamically adjust to show all data. Values outside explicit bounds are not rendered. Its example JSON uses `y_axis.min: 0`; the page does not document a separate soft bound or an automatic zero policy.

## CloudWatch

The [CloudWatch dashboard graph guide](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/add_graph_dashboard.html) offers optional minimum and maximum Y axis limits. The [AWS CDK YAxisProps reference](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudwatch.YAxisProps.html) says `min` and `max` default to Auto. The [metric widget model](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Metric-Widget-Structure.html) places numeric bounds under `yAxis.left` or `yAxis.right`. Neither source describes a soft bound or a zero-inclusion setting.

## Honeycomb

The [query result chart settings](https://docs.honeycomb.io/investigate/query/customize-results/) list **Linear Scale** (default) and **Log Scale** for the Y axis, plus chart type and missing-value options. They do not list a numeric min/max or zero-inclusion setting. This is a statement about the cited public settings page, not a claim that no other Honeycomb interface has such a control.

## Perses

The [official TimeSeriesChart model](https://perses.dev/plugins/docs/timeserieschart/model/) places optional `min` and `max` under `spec.yAxis`. The [current plugin schema](https://github.com/perses/plugins/blob/main/timeserieschart/schemas/time-series.cue) types them as numbers, requires `max >= min` when both are set, and offers `logBase` values 2 and 10. The [plugin model and editor labels](https://github.com/perses/plugins/blob/main/timeserieschart/src/time-series-chart-model.ts) show default `min` and `max` as `undefined` and label the fields **Min** and **Max**. There is no separate soft bound or include zero field in these sources. The exact automatic lower bound algorithm was not verified.

Representative panel fragment from the published model:

```yaml
plugin:
  kind: TimeSeriesChart
  spec:
    yAxis:
      min: 0
      max: 100
```

The fragment shows the field locations, not a recommended default. [Source](https://perses.dev/plugins/docs/timeserieschart/model/).

## Datadog

The [timeseries widget documentation](https://docs.datadoghq.com/dashboards/widgets/timeseries/) names **Min**, **Max**, **Scale**, and **Always include zero**. It says min/max accept a numeric value or **Auto**, and the zero control chooses between including zero and fitting the data range. Its default is to include zero. The documentation also describes clipping the axis to a specified range. JSON uses `yaxis` and optional `right_yaxis`; their `min` and `max` fields are strings with default `"auto"`, and `scale` defaults to `"linear"`. Supported scales are linear, log, square root, and powers.

The [official dashboard querying example](https://docs.datadoghq.com/dashboards/querying/) shows the default JSON shape:

```json
{
  "yaxis": {
    "scale": "linear",
    "min": "auto",
    "max": "auto",
    "include_zero": true,
    "label": ""
  }
}
```

This is a separate zero switch rather than a soft minimum. The published timeseries widget schema does not name soft bounds. [Source](https://docs.datadoghq.com/dashboards/widgets/timeseries/).

## Dash0

The [panel editor guide](https://www.dash0.com/docs/dash0/dashboards/configure-panels) calls the option **Min/Max** and describes dynamically determined bounds or fixed numbers. It also documents a **Scale** setting for linear and logarithmic display on applicable panels. The [TimeSeriesChart definition](https://www.dash0.com/docs/dash0/dashboards/types/TimeSeriesChart) lists `yAxis.min` and `yAxis.max`, but does not specify their types, default values, clipping behavior, or zero policy. It lists a `dash0Extensions.yAxis` object without defining its keys. No soft min/max or include zero field is documented on that page.

Representative fragment based on the published property paths:

```yaml
plugin:
  kind: TimeSeriesChart
  spec:
    yAxis:
      min: 0
      max: 100
```

The fragment illustrates the names only. The docs do not publish a complete working example with those fields. [Source](https://www.dash0.com/docs/dash0/dashboards/types/TimeSeriesChart).

## Everr model chosen

Everr uses an optional `yAxis` object with `min` and `max`, following the shape used by Perses and Dash0. Each bound accepts a finite number or `auto`; omission means `auto`. Numeric bounds are exact and clip values outside the range. When both are numeric, `min` must be less than `max`.

```yaml
plugin:
  kind: TimeSeriesChart
  spec:
    yAxis:
      min: 0
      max: auto
```

With both bounds automatic, ordinary lines fit their visible data with padding and readable ticks. A positive-only chart with `min: 0` gets a zero baseline. A numeric `min: 0` clips negative data; Grafana's soft minimum would instead extend below zero to preserve it. Stacked areas include zero in their automatic range. The model can gain soft bounds later if dashboard authors need a reference value without clipping.
