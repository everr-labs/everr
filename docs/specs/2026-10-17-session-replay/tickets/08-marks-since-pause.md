# 08: Marks, `since`, truncation, pause and resume

**What to build:** An integrator marks the start of a flow with `markRecording("cart-open")` and later sends the whole flow with `emitRecording({ since: "cart-open" })`. Marks also appear as logs on every Session's timeline. A Clip whose start has left the buffer says it was truncated. `pauseRecording()` and `resumeRecording()` keep a sensitive screen out of the buffer.

**Blocked by:** 02

**Complexity:** medium

**Verify:** `pnpm --filter @everr/otel-web test && pnpm --filter @everr/otel-web typecheck && pnpm --filter @everr/otel-web size`

**Status:** ready-for-agent

- [ ] `markRecording(name)`: a named point in the current Stream's buffer; the same name replaces the earlier mark; the mark leaves with the events at its time
- [ ] Each mark emits a log `everr.browser.recording.mark` with `everr.recording.mark.name`, also in unsampled Sessions, stored in `logs`
- [ ] `emitRecording({ since })` accepts a mark name or an epoch-ms timestamp; `last` and `since` are exclusive in the types
- [ ] `everr.recording.clip.truncated = true` on Segments and span when the requested start is before the oldest buffered moment, with the Clip starting there
- [ ] Pause: nothing buffered while paused; resume takes a full snapshot; a Clip across a pause has a gap
- [ ] Catalog updated
