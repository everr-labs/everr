# @everr/otel-profiler

## 0.13.0

### Minor Changes

- f7c6638: First release. Continuous wall-time, CPU-time and heap profiling for Node.js, exported as OTLP profiles. Samples taken inside a span link to it, carry the time they were taken, and name their request with `http.route` and `everr.root_span.name`. File names are sent relative to the repository root, so they work as source links.

### Patch Changes

- 0693e57: Frames from bundled files whose names contain characters such as `[` or `]`, like `vendor+[...].mjs`, now resolve through their source maps instead of showing the bundle file.
