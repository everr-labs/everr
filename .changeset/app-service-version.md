---
"@everr/app": patch
---

The self-hosted app's own server and browser telemetry now reports the release version as `service.version`. Before, the server left it out and the browser reported `0.0.0-dev`. Set `SERVICE_VERSION` at runtime to override the server value.
