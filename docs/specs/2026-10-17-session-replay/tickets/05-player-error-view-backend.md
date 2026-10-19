# 05: Player on the error view and for backend entries

**What to build:** The error view gets the same player. A backend entry (server function, same-origin API call, cross-origin call with `traceparent`) opens the Clip of the browser Session that caused it. The player shows truncation, paused ranges, and Segment gaps.

**Blocked by:** 04

**Complexity:** medium

**Verify:** `pnpm --filter @everr/app test:ci && pnpm --filter @everr/app typecheck`

**Status:** ready-for-agent

- [ ] Error view: opens on the Span carrying the exception log when it has a span id, otherwise at the log's timestamp; stack stays `exception.stacktrace`
- [ ] Backend entry: Session, stream id, and browser `ServiceName` come from the Trace's browser Client spans; disagreement means no Session or no Clip
- [ ] Player marks `everr.recording.clip.truncated`, the trigger moment and tail of automatic Clips, paused ranges, and gaps in `everr.recording.segment.index`
- [ ] Route tests cover backend entries, disagreeing Client spans, and the error view
