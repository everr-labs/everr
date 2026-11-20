---
"@everr/cli": patch
---

In the local Explore pages (Logs, Traces, Errors, Metrics), a relative time range that ends before it starts, such as "today until 5 hours ago" opened before 05:00, no longer sends queries or shows errors. The pages show their empty state, and the time range picker turns red.
