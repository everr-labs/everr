---
"@everr/app": patch
"@everr/cli": patch
---

Opening an error from the Errors page now shows its detail as a full page, the same way traces and metrics open, instead of in a modal. The back button returns to the Errors list with your filters kept. This applies in Everr and in the local explorer.

Rows in the Errors list are now the same height as rows in the Traces list. The Trend column is now a heatmap strip: every row has the same time cells, lined up in columns down the list, and a busier interval is a stronger shade on one scale shared by all rows, so you can spot errors that started in the same window.
