# 02: Tracer bullet: `emitRecording({ last })` lands in the local recordings table

**What to build:** An integrator adds `recording()` from `@everr/otel-web/recording`. In a sampled Session the stub lazy-loads the recorder chunk (`@rrweb/record`, pinned to the `rrweb@2.1.7` release) and buffers the last 5 minutes with a full snapshot every 10 seconds (no thinning or memory cap yet). `emitRecording({ last })`, or `emitRecording()` for the whole buffer, sends a Clip: Segments as OTLP logs with event name `everr.browser.recording.segment`, plus one `recording` root span covering the Clip's range. The local Collector routes Segments by event name into a local recordings table. A developer can emit a Clip from a local page and find it with `everr-dev local query`.

**Blocked by:** None (can start immediately)

**Complexity:** high

**Verify:** `pnpm --filter @everr/otel-web test && pnpm --filter @everr/otel-web typecheck && pnpm --filter @everr/otel-web size && (cd collector && make test-all)`

**Status:** ready-for-agent

- [ ] New subpath `@everr/otel-web/recording` exports `recording()` and `emitRecording()`; the main entry does not import it
- [ ] The recorder is its own chunk, loaded with `import()` only in a Session sampled by `sampleRate` (default 1), decided with `hashUnit` over `${sessionId}:recording`
- [ ] One recorder per page; a second `recording()` does nothing
- [ ] Nothing is sent until `emitRecording()` is called; `emitRecording()` before the chunk loads or in an unsampled Session does nothing
- [ ] A Clip starts at the last full snapshot at or before the requested start; Segments carry `everr.recording.clip.id`, `everr.recording.stream.id`, `everr.recording.segment.index` from 0, close at about 950 KB, and go on their own request outside the shared logs queue
- [ ] `everr.recording.stream.id` is ambient on the envelope while the Stream buffers
- [ ] One `recording` span per Clip: `startSpan` with `root: true` and `startTime` at the requested start, ended at the Clip end, trigger `manual`, never a parent of later records
- [ ] Local Collector: chdb exporter writes Segments to a recordings table (payload columns of local `logs` plus `session_id`, `stream_id`, `clip_id` with bloom filters), never to `logs`; other logs unaffected (chdb smoke test)
- [ ] size-limit lines for the stub and the recorder chunk
- [ ] Browser events catalog in the telemetry skill lists the new names
- [ ] Verified end to end: emit a Clip from a local page, query the `recording` span and the recordings table with `everr-dev local query`
