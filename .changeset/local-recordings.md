---
"@everr/cli": patch
---

`everr local` stores the recording Segments that `@everr/otel-web` sends in their own `recordings` table, not in `logs`. Read them with `everr local query`: the `logs` columns plus `session_id`, `stream_id`, and `segment_index`.
