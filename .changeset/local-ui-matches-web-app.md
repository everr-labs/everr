---
"@everr/cli": minor
---

The local UI started by `everr local start` now looks and behaves like the Everr web app.

- **Same frame:** the sidebar, header and page layout are the web app's. The page name shows in the header, and Settings sits at the bottom of the sidebar.
- **Time range and refresh follow you:** pick a range or an auto-refresh interval once and it stays when you move between Metrics, Logs, Traces and Errors. It used to reset on each page.
- **Back undoes one filter change:** each filter change adds a history entry, so Back steps through them one at a time. Filters used to rewrite the current entry.
- **Traces recover on their own:** a trace opened while the collector is starting loads once the collector is running, with no reload.
