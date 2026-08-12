---
"@everr/desktop-app": minor
---

Every Explore filter now sits in one rail on Traces, Logs and Errors. Service and Environment move out of the toolbar under the title bar, and the search field moves out of its own bar above the results, so the whole query reads in a single column.

The rail has two zones. The top zone holds Service and Environment, which stay set as you move between the three pages. Everything below the divider belongs to the current page and is reset by `Clear page filters`, which no longer skips the search field the way `Clear all` did. In a narrow window the rail moves into a sheet behind a `Filters` button that shows how many filters are active.

Trace rows also change. The HTTP method of the root span renders as a badge, in one tone for methods that read and another for methods that change state. The service moves into its own column next to its colour dot. A new status column replaces the span count: it shows the HTTP response status code when the root span has one, and OK or Error otherwise. Its colour comes from whether any span in the trace failed, which matches what the Status filter selects, so a 404 that the service handles stays green. The warning triangle is gone, since the status column now carries that state.
