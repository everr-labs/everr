# 07: Automatic Clips

**What to build:** Without any integrator code, an error or a failed request sends a Clip of the last 60 seconds plus the 10 seconds after. Bursts extend one Clip instead of sending many, and a Session gets at most 5 automatic Clips. `next` also works on manual `emitRecording()`.

**Blocked by:** 02

**Complexity:** medium

**Verify:** `pnpm --filter @everr/otel-web test && pnpm --filter @everr/otel-web typecheck && pnpm --filter @everr/otel-web size`

**Status:** ready-for-agent

- [ ] Triggers through internal seams (no new public `InstrumentationContext` member): errors after the `errors()` `ignore` and `denyUrls` filters; `network()` spans with 5xx or no response; never 4xx
- [ ] Automatic Clip: `last: 60_000`, `next: 10_000`, trigger `error` or `network`
- [ ] A trigger inside an open automatic tail extends it to 10 s after the new trigger, capped at 60 s after the first trigger
- [ ] At most 5 automatic Clips per Session, counted next to the Session in the identity store (shared by tabs and reloads); manual Clips never merge or count
- [ ] `next` (max 60 000) on `emitRecording()`: the part already buffered is sent at once, the tail as more Segments when it closes, closing a Segment every 5 s
- [ ] Catalog updated for trigger values
