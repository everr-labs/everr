---
"@everr/app": patch
"@everr/otel-web": patch
"@everr/otel-errors": patch
"@everr/tanstack-start-otel": patch
---

The app and the SDK packages now ship source maps. Browser devtools show the app's original source in stack traces and the debugger, and stepping into `@everr/otel-web`, `@everr/otel-errors`, or `@everr/tanstack-start-otel` from your code shows their TypeScript source instead of the built output. The SDK code your bundler includes is unchanged in size.
