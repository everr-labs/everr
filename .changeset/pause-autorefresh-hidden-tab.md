---
"@everr/app": patch
---

Auto-refresh on dashboards and Explore pages now pauses while the browser tab is in the background, so a tab you aren't looking at no longer keeps running queries. When you come back, the page refreshes once if at least one refresh interval has passed. With auto-refresh off, the page doesn't refresh when you come back.
