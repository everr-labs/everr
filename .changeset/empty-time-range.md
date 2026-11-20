---
"@everr/app": patch
"@everr/cli": patch
---

A relative time range that ends before it starts, such as "today until 5 hours ago" opened before 05:00, no longer sends queries or shows errors on the Explore pages (Logs, Traces, Errors, Metrics), in Everr and in the local explorer, or on Runs in Everr.

- The pages show their empty state.
- The time range picker turns red, and its tooltip says the range ends before it starts.
- In Everr, such a range is no longer swapped into a different one when you open a page. Two dates in the wrong order still are.
