---
"@everr/app": patch
"@everr/app-cloud": patch
---

Pages no longer jump around while they load.

- Moving between pages keeps the current page on screen, with a thin progress bar at the top, until the next one is ready, instead of a full-page spinner. The breadcrumb names the page you are going to right away, including a dashboard's or runbook's name when you open it from its list.
- Loading placeholders now match what replaces them: the Logs, Traces and Errors lists, the alerting rules list and rule detail, dashboard and runbook lists, the trace viewer, the Metrics catalog and the filter pickers keep their columns, row heights and headers when the data arrives.
- Changing a filter or the time range keeps the current results on screen, dimmed, until the new ones arrive, on the Explore pages, alerting pages and error details, instead of clearing them to a placeholder.
- Navigating between pages is faster: the app no longer redraws its sidebar and top bar several times on every navigation.
- Home shows your dashboard straight away instead of a placeholder while it checks your setup.
- Settings pages (account, members, API keys, GitHub) load their data with the page instead of after it.
- Dialogs and side panels (new channel, edit delivery, new silence, change role, alert and log details on small screens) now animate out when closed instead of vanishing.
- Log and trace timestamps no longer wrap onto two lines in Safari, and the log severity counts stay blank instead of showing "—" until they load.
