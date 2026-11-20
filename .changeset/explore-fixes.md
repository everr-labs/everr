---
"@everr/app": patch
"@everr/cli": patch
---

Explore and chart fixes:

- **Auto-refresh in Everr:** Logs, Traces and Errors now fetch their data once per interval instead of twice.
- **Local trace view:** a trace no longer refreshes on its own when you open it from a Traces page with auto-refresh on, as in Everr. Reopen it or reload the page to see spans that arrived later.
- **Filter focus:** clearing a Service or Environment filter with the keyboard now leaves focus on the filter, so the next Tab continues from there instead of from the top of the page.
- **Isolated points in Everr:** line and area charts, including dashboard time series panels and the repository and run charts, now draw a dot for a point with no data on either side. Such a point used to be invisible, so a series that reported once in the range looked empty.
