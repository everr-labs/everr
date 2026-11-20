---
"@everr/app": patch
---

Calendar time ranges such as "Today", "Yesterday", "This week" and "This month so far" now cover your local day, week or month on every page: Logs, Runs, dashboards, workflows, repositories, cost analysis and alerting. They used to cover the UTC day on these pages, so outside UTC+0 the results didn't match the dates shown in the time picker. The Service, Environment and attribute filter lists follow the same window.

Bars in the Logs and Runs volume histograms and the cost analysis Actions usage chart now start at your local midnight and on your local hour, instead of at UTC boundaries, and the Actions usage chart labels them in your time zone.
