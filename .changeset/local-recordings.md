---
"@everr/cli": patch
---

`everr local` stores the recording Segments that `@everr/otel-web` sends in their own `recordings` table, not in `logs`. Read them with `everr local query`: the `logs` columns plus `session_id`, `stream_id`, `segment_index`, `segment_end`, `clip_start`, `clip_id`, `trigger`, and `truncated`, the same as on a server installation. The first start after this update clears the local telemetry store, which `everr local` fills again from new telemetry.
