---
"@everr/app": minor
---

Panel colors that fill shapes with text on top must now be opaque hex colors such as `#fff` or `#22c55e`, so that text always gets a readable foreground. This covers StatChart and GaugeChart `thresholds.defaultColor` and `thresholds.steps[].color`, and the `colors` map of BarChart, StateTimeline, and StatusHistory. `everr apply` rejects dashboards and runbooks that use named colors, `rgb()`, `hsl()`, CSS variables, or hex with alpha (`#22c55e80`) in these fields. A saved panel that still uses one of these colors renders without that option (no thresholds, or the default palette) and shows a warning until you reapply it with hex colors. StatChart sparkline `colors` are unchanged.
