---
"@everr/app": patch
"@everr/cli": patch
---

Zooming by dragging across a chart now works the same on dashboards, on the Logs page and on Runs. Logs changes in Everr and in the local explorer.

- A click no longer zooms, and neither does a press that moves only up or down. A drag must select at least one second.
- On Logs and Runs, each zoom adds a history entry, so Back returns to the previous range. It used to replace it.
- The selection looks the same as on dashboards, and the mouse pointer stays the default arrow.
- On a touch screen, tapping or sliding a finger sideways across the Logs and Runs volume charts shows the values under it, as on dashboard charts. Vertical swipes still scroll the page.
