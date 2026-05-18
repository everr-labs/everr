---
"@everr/desktop-app": patch
---

Refresh stale query data when the window regains focus and cap cached
results at 30s instead of holding them forever. Previously the desktop
app kept the first response in memory indefinitely and never refetched
when reopened, so runs and notification settings could appear out of
date until the app was restarted.
