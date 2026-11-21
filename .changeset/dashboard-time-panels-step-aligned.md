---
"@everr/app": patch
---

Dashboard panels now agree on the current time: every panel on a dashboard reads the time range at the same moment, including panels that load as you scroll and panels that re-run when you change a variable. Refreshing, or changing the time range, moves them all to the new time together.

Time series, heatmap, state timeline and status history panels also start their range on a whole interval, so the first point covers a full interval instead of reading low at the left edge. The chart still ends at the current time. Stat panels and their sparklines, tables and other totals keep the exact time range.
