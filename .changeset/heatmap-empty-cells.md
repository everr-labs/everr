---
"@everr/app": patch
---

Heatmap panels with `xColumn` now keep a column and row for every row your query returns, even when its value is empty. An empty value draws as an empty cell instead of removing that x value or bucket from the axes. To keep the same layout on every time range, such as all 7 weekdays × 24 hours, return the full grid with `NULL` where nothing reported.
