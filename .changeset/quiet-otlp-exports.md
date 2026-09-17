---
"@everr/otel-web": patch
---

Capture fetch before SDK initialization so OTLP exports do not create network spans when an earlier SDK instance has already instrumented fetch.
