---
"@everr/desktop-app": patch
---

The `everr-setup-telemetry` skill now has an `aws-lambda` rule for Node.js functions on AWS Lambda: a collector extension exports to Everr, the SDK starts from a preload only when an endpoint is set, and logs flush with the invocation span before the runtime freezes the process.
