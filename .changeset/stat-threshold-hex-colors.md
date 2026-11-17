---
"@everr/app": minor
---

Stat and Gauge panel threshold colors (`thresholds.defaultColor` and `thresholds.steps[].color`) must now be opaque hex colors such as `#fff` or `#22c55e`, so tiles filled with a threshold color always get a readable foreground. `everr apply` rejects dashboards and runbooks that use named colors, `rgb()`, or hex with alpha (`#22c55e80`). A saved panel that still uses one of these colors renders without its thresholds and shows a warning until you reapply it with hex colors.
