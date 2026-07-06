---
"@everr/desktop-app": patch
---

The `everr-setup-telemetry` skill now covers direct browser ingestion: a new `browser` rule explains public origin-bound ingest keys, endpoint gating for keyless deploys, error capture, and validation. The old guidance saying all browser telemetry must proxy through a backend now applies to secret keys only.
