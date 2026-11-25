---
"@everr/otel-profiler": patch
---

Frames from bundled files whose names contain characters such as `[` or `]`, like `vendor+[...].mjs`, now resolve through their source maps instead of showing the bundle file.
