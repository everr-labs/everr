---
"@everr/app": minor
---

Panel colors you set in dashboards and runbooks must now be opaque hex colors such as `#fff` or `#22c55e`, so text drawn on a colored fill always gets a readable foreground. This covers StatChart and GaugeChart `thresholds.defaultColor` and `thresholds.steps[].color`, and the `colors` map of StatChart, BarChart, StateTimeline, and StatusHistory. `everr apply` rejects resources that use named colors, `rgb()`, `hsl()`, CSS variables, or hex with alpha (`#22c55e80`) in these fields. A saved panel that still uses one of these colors renders without that option (no thresholds, or the default palette) and shows a warning until you reapply it with hex colors.
