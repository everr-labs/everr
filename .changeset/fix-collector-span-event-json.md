---
"@everr/desktop-app": patch
---

Fix local collector batch rejection when spans contain events or links, including BullMQ's `job completed` event. Preserve event and link attributes as JSON objects with their original value types.
