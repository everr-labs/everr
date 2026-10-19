---
"@everr/cli": patch
---

Fix direct trace links getting stuck loading. Resolve trace bounds by ID so traces load independently of URL time ranges, and remove unnecessary timestamps from trace links.

Keep trace lookup metadata until the latest span in each ingestion batch expires.
