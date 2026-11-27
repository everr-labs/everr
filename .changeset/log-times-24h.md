---
"@everr/app": patch
"@everr/app-cloud": patch
"@everr/cli": patch
---

Times across the app now use one format: a 24-hour clock with zero-padded fields, such as `04:05:06` or `14:54`, with dates written as `Nov 10` (the year added when it is not the current one). This covers logs, traces, errors, chart axes and tooltips, the time range picker, alerts, cost analysis and settings. Times no longer mix a 24-hour hour with an AM/PM suffix or switch format from one page to the next.
