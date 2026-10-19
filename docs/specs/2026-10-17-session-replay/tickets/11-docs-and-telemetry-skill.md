# 11: Public docs and the telemetry skill

**What to build:** Integrators can set up recording from the docs alone, and Agents know how to find Clips and marks without reading rrweb.

**Blocked by:** 06, 07, 08

**Complexity:** low

**Verify:** `pnpm --filter @everr/docs build`

**Status:** ready-for-agent

- [ ] Docs page for `recording()`: setup, `sampleRate`, the four functions with `last`/`since`/`next`, automatic Clips, privacy defaults and options, the `sampled()` multiplication warning
- [ ] Known limits: `dev: true` sends unmasked content, `emitRecording()` does nothing in unsampled Sessions, CSS `background-image` not Blocked, no mutation cap, document requests and Traces with no browser Client span have no Session
- [ ] Telemetry skill: the recordings table is rrweb and the wrong payload for an Agent; find Clips with `SpanName = 'recording'`, marks with the mark event name
- [ ] No em or en dashes in the docs
