# 04: Player on the trace view (browser entry)

**What to build:** A developer opens a Trace from a browser entry and, when a Clip covers that moment, sees the player (Stage layout from the `prototype/replay-player` branch) above the existing trace view. Clicking a Span seeks the player; while playing, the Span under the clock is selected. When no Clip covers the moment, the player area says "no clip at this moment" and links to the Session's Clips. A Trace with no Session has no player. Works against the local Collector and the Cloud with the same query.

**Blocked by:** 02

**Complexity:** high

**Verify:** `pnpm --filter @everr/app test:ci && pnpm --filter @everr/app typecheck`

**Status:** ready-for-agent

- [ ] Clip choice: `recording` spans with the entry's `session.id` and stream id whose range covers the entry time; earliest start wins
- [ ] The whole Clip loads with `ServiceName`, time window (span range, start 60 s earlier), `session_id`, and `clip_id`; no `tenant_id` in the query
- [ ] `@rrweb/replay` at the recorder's version; playback starts at the requested start
- [ ] Span click seeks; playing selects the Span under the clock
- [ ] "no clip at this moment" with links; no player without a Session
- [ ] The trace list leaves out root spans named `recording`
- [ ] Route tests with ClickHouse mocked at `execute` cover each case above
- [ ] Checked by hand in the app with a Clip emitted from a local page
