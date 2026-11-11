---
"@everr/app": minor
"@everr/cli": minor
---

Everr now accepts OpenTelemetry profiles, and Explore has a new **Profiles** page, in Everr and in the local explorer opened by `everr local start`.

- **Ingest:** send OTLP profiles to the same endpoint as your traces, logs and metrics. Profiles are kept for their own retention period.
- **Flame graph:** shows where your services spend CPU time, wall time or memory, for every sample type they send. Hover or pin a function to highlight its frames, and right-click a frame for more actions.
- **Top functions:** lists the functions with the most samples, with their callers and callees. The table follows the frame you zoom into.
- **Compare:** compare the range against the previous period, a custom window or an earlier `service.version`, to see which functions got slower.
- **Samples over time:** a histogram of samples, and drag across it to zoom. For Node.js services, event loop delay and GC time are charted alongside.
- **Traces:** a trace with linked samples shows a Profiles link, and a span with samples gets a Profile tab.
- **Filters:** Service and Environment carry over from the other Explore pages, and their menus now include services that send only profiles.
