---
"@everr/desktop-app": patch
---

The `everr-setup-telemetry` Next.js rule now turns off incoming request tracing in the HTTP instrumentation and uses the server span that Next.js makes for each request. Next.js creates its HTTP server before `register()` runs, so the HTTP instrumentation missed requests. The rule also sets `NEXT_OTEL_FETCH_DISABLED=1`, so each `fetch` is traced once and not twice.
