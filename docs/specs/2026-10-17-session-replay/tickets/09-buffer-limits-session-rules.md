# 09: Buffer limits and Session rules

**What to build:** The buffer stays inside a fixed memory cap on heavy pages, Clip traffic never keeps a Session alive, and a Clip never mixes two Sessions.

**Blocked by:** 02

**Complexity:** high

**Verify:** `pnpm --filter @everr/otel-web test && pnpm --filter @everr/otel-web typecheck && pnpm --filter @everr/otel-web size`

**Status:** ready-for-agent

- [ ] Buffer capped at 10 MB of raw rrweb JSON, oldest events dropped first
- [ ] Snapshot thinning: all 10 s snapshots kept for the last 60 s, one per minute older; a Clip still starts at a snapshot at or before its requested start
- [ ] A single event over 950 KB goes alone in its own Segment
- [ ] Session change during a page: the Stream ends, its buffer is dropped, `sampleRate` is decided again, a new Stream starts with a new stream id and a full snapshot
- [ ] Passive Session read: Segments, the `recording` span, and mark logs do not refresh Session activity; a Session with only Clip traffic ends after 30 idle minutes
- [ ] Sampling test over a sweep of Session ids matches `sampleRate`, same decision across reload and tabs
- [ ] Responsiveness checked by hand on a heavy page
