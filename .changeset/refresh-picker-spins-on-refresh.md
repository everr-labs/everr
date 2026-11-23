---
"@everr/app": patch
"@everr/cli": patch
---

The refresh button now reloads only the page's data: dashboard panels, charts, Explore results, runs and alerts. It no longer refetches the session, settings, dashboard and runbook definitions or filter value lists, so auto-refresh sends fewer requests. Those still update on their own, for example when you return to the tab. The one exception is the dashboard you have open: reload the page to see changes you just applied to it.

The button also spins only while that data loads, whether a refresh, a time range change or opening the page started the load. It used to spin for every request in flight.
