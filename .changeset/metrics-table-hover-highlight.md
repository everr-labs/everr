---
"@everr/app": patch
"@everr/cli": patch
---

On the Metrics page, hovering a series in the table under the chart highlights its line in the chart and dims the others. This works in Everr and in the local explorer.

Chart lines are now 1px wide. Dashboard time series panels default to a `lineWidth` of `1` instead of `1.5`; a panel that sets `lineWidth` keeps its value.
