---
"@everr/app": patch
---

Dense time-series charts now draw exactly as if every point were plotted at browser zoom levels and display scales that are not a whole number, such as 125% or 150%. Before, a spike or a step could be drawn up to one screen pixel off its real position, or a little short of its full height.
