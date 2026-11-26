---
"@everr/app": minor
---

Store browser session recordings on self-hosted installations in their own table, apart from logs. The SQL API can list them without the recording content (`Body`). The app creates `app.recordings` on startup, and the collector routes the Segments that `@everr/otel-web` sends to it instead of `logs`. The trace view and the error detail play them as they do on Cloud. This release needs the new `deploy/collector.yaml` together with the new images. An old file keeps Segments in `logs`, and the new file fails to start on an older collector image (unknown component `routing`). Segments sent before the upgrade stay in `logs` and do not play.
