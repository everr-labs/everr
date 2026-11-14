---
"@everr/otel-profiler": minor
---

First release. Continuous wall-time, CPU-time and heap profiling for Node.js, exported as OTLP profiles. Samples taken inside a span link to it, carry the time they were taken, and name their request with `http.route` and `everr.root_span.name`. File names are sent relative to the repository root, so they work as source links.
