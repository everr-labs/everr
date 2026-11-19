---
"@everr/app": minor
---

Store browser session recordings on self-hosted installations. The app creates `app.recordings` on startup, the collector routes the Segments that `@everr/otel-web` sends to it instead of `logs`, and the trace view, the error detail, and `everr cloud recording show` read them as they do on Cloud. Restart the collector after upgrading so it picks up the new routing. Segments sent before the upgrade stay in `logs` and do not play.
