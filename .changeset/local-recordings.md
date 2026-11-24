---
"@everr/cli": patch
---

`everr local` stores the recording Segments that `@everr/otel-web` sends in the `recordings` table, not in `logs`, as a server installation does. Read them with `everr local query`: the `logs` columns plus `session_id`, `stream_id`, `segment_index`, `segment_end`, `clip_start`, `clip_id`, `trigger`, and `truncated`.
