---
"@everr/otel-errors": patch
---

Accept `@opentelemetry/api-logs` and `@opentelemetry/instrumentation` from 0.218 through 0.223. The previous `^0.218.0` peer stopped before 0.219, so npm would not install this package next to the 0.223 line that `@opentelemetry/instrumentation-aws-sdk` 0.78 requires.
