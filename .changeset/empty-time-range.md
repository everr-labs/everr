---
"@everr/app": patch
---

A relative time range that ends before it starts, such as "today until 5 hours ago" opened before 05:00, no longer sends queries or shows errors on the Explore pages (Logs, Traces, Errors, Metrics) or Runs. The pages show their empty state, and the time range picker turns red. Its tooltip says the range ends before it starts. Such a range is no longer swapped into a different one when you open a page; two dates in the wrong order still are.
