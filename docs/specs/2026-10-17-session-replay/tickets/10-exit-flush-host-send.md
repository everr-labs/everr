# 10: Exit flush and host `send` for Segments

**What to build:** When the page hides during an open Clip, the app's own Spans and Logs still go first; any unsent Segment only uses the room they leave. The Clip's `recording` span still reaches Everr. Hosts with a custom `send` get every Segment in full.

**Blocked by:** 01, 07

**Complexity:** medium

**Verify:** `pnpm --filter @everr/otel-web test && pnpm --filter @everr/otel-web typecheck && pnpm --filter @everr/otel-web size`

**Status:** ready-for-agent

- [ ] Exit order inside the 64 KB keepalive budget: Spans 16 KB, then Logs, then an unsent Segment with what is left up to 32 KB, dropped whole if it does not fit (gap in the index)
- [ ] Spans and Logs are never cut for a Segment
- [ ] An open tail at page hide: its `recording` span goes in the exit flush with the end at the page hide
- [ ] Host `send`: one `send("logs", body)` per Segment with plain JSON, no gzip, unsent Segments in full at exit
- [ ] No retry; failed requests show as index gaps
