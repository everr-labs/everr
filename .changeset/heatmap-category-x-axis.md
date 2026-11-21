---
"@everr/app": minor
---

Heatmap panels have a new `xColumn` option. When it's set, the x-axis shows that column's values as categories instead of time, so a panel can show a grid like hour of day × weekday or region × tier without a time column. Numeric values, like hours, sort from smallest to largest left to right. Other values keep the order your query returns them in. These panels don't support drag-to-zoom, and the tooltip shows the x label. Heatmaps without `xColumn` work as before.
