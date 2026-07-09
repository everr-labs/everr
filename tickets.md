# Tickets: Error triage

Tracer-bullet slices building agent fix handoff, Investigations, Resolutions, and derived Status for Errors. Source spec: docs/specs/0001-error-triage.md (see also docs/adr/0004-error-triage-events-table.md).

Work the **frontier**: any ticket whose blockers are all done.

## Record an Investigation from the web UI

**What to build:** A User opens an Error's detail page, writes a markdown Investigation, and sees it appear in a new chronological timeline on that page. The Investigation lives in the dedicated append-only events table keyed by tenant and Fingerprint (ADR 0004), stamped server-side with tenant and author id (display name resolves from the profile at read time). The author can edit or delete their own entries, recorded as version rows; the timeline marks edited entries. Every write projects a metadata-only activity marker into the logs table, so the plain SQL query surface shows triage activity without carrying content.

**Blocked by:** None, can start immediately.

- [x] Investigation form on the Error detail page persists a markdown Investigation
- [x] Error detail shows a timeline of events for the Fingerprint, oldest to newest, with author and timestamp
- [x] Events land in app.error_triage_events; edits and deletes are author-only version appends, and edited entries are marked in the timeline
- [x] Tenant and author are stamped server-side; a client cannot spoof either
- [x] Triage activity markers (no body, no author) are readable via the cloud SQL query surface
- [x] Repository and write-module behavior covered at the fake-client seams

## Status events with badges and filter

**What to build:** A User resolves (with a markdown explanation), ignores, or reopens an Error from its detail page. The errors list derives each Error's Status at read time (latest status event wins; a newer Occurrence reopens a resolved Error by plain timestamp comparison for now) and shows it as a badge, with a status filter in the search schema. Ignored is sticky: new Occurrences never lift it. Status changes appear in the detail timeline alongside Investigations.

**Blocked by:** Record an Investigation from the web UI.

- [ ] Resolve, ignore, and reopen controls on the Error detail write status events into the same events table
- [ ] Resolution captures a markdown explanation shown in the timeline
- [ ] Errors list shows a Status badge per Error and a status filter; all statuses visible by default
- [ ] Status is derived in the summary query; no stored status anywhere
- [ ] Ignored stays ignored regardless of new Occurrences; only a manual status change lifts it
- [ ] With zero triage events the list behaves exactly as before this work
- [ ] Derivation and filter covered at the fake-execute-client seam

## Version-aware Regression rule

**What to build:** A resolved Error reopens only when it genuinely regresses: an Occurrence whose service version was first seen after the Resolution. Versions are ordered by first-seen time in telemetry (never semver or SHA comparison). An Occurrence with no service version falls back to plain timestamp comparison. Same-version stragglers from old deploys keep the Error resolved. Regressed Errors are visibly flagged in the list and on the detail page. Proven end-to-end by the first env-gated real-ClickHouse integration test (skipped when the env var is absent, mirroring the existing real-Postgres pattern).

**Blocked by:** Status events with badges and filter.

- [ ] Occurrence from a version first seen after the Resolution reopens the Error, flagged as regressed
- [ ] Occurrence from the resolved-in version leaves the Error resolved
- [ ] Versionless Occurrence newer than the Resolution reopens the Error
- [ ] Ignored Errors are unaffected by the rule
- [ ] Env-gated real-ClickHouse integration test seeds Occurrences, Resolutions, and version history and proves all four behaviors above
- [ ] Regressed flag visible in list badge and detail header

## Cloud CLI errors read surface

**What to build:** An Agent (or User) runs the cloud errors list command to survey what is broken, filtered by status and service, and the show command with a Fingerprint to get full context: message, stacktrace, Occurrences with trace links, current Status, and the event timeline. Backed by a new authenticated REST endpoint reusing the same errors repository as the web UI, so grouping and status semantics cannot drift.

**Blocked by:** Status events with badges and filter.

- [ ] Cloud errors list command prints Errors with Status, counts, and last-seen, honoring status and service filters
- [ ] Cloud errors show command prints full Error context including Investigations and Resolutions
- [ ] REST endpoint is authenticated and tenant-scoped, reusing the shared errors repository
- [ ] Command family covered by the existing Rust stub-server integration-test pattern

## Cloud CLI errors write surface with attribution

**What to build:** An Agent records findings and completes triage from the terminal: investigate, resolve, ignore, and reopen subcommands accepting markdown via stdin or a file flag, writing through an authenticated REST endpoint backed by the same server-side write module as the web UI. Writes carry the authenticated User plus an advisory agent marker flag; the web UI timeline renders both ("agent, authorized by user"). The full round trip works: an Agent resolves an Error and its badge flips in the web UI.

**Blocked by:** Cloud CLI errors read surface.

- [ ] Investigate and resolve subcommands accept markdown via stdin or file flag
- [ ] Ignore and reopen subcommands emit the corresponding status events
- [ ] Agent marker flag recorded on the event and rendered in the web UI timeline with the authorizing User
- [ ] Events written via CLI are indistinguishable in shape from web-written ones
- [ ] Write payloads covered by the Rust stub-server integration-test pattern

## Agent handoff prompt and Skill loop

**What to build:** A User picks an Error in the web UI and clicks a handoff action that copies an agent-agnostic prompt: the goal, the Fingerprint, and the instruction to run the errors show command for full context. The Everr Skill teaches the complete loop: fetch context, record an Investigation, fix the code, record the Resolution. Pasting the prompt into any Agent yields a fix plus a persisted Investigation and Resolution: flow 1 demoable end to end.

**Blocked by:** Cloud CLI errors read surface; Cloud CLI errors write surface with attribution.

- [ ] Copy-handoff-prompt action on the Error detail page
- [ ] Prompt is agent-agnostic: no deep links, no per-agent launchers
- [ ] Skill updated to teach fetch, investigate, fix, resolve
- [ ] Manual end-to-end run: handoff prompt through a real Agent produces an Investigation and a Resolution visible in the UI

## Local errors surface in the CLI (read-only)

**What to build:** The errors read commands work against the Collector: local list and show query the Collector's storage and mirror the cloud output. Local triage writes are deferred until the Collector grows a counterpart of the events table (ADR 0004); until then local Errors carry no Status and no timeline.

**Blocked by:** Cloud CLI errors read surface.

- [ ] Local errors list and show mirror the cloud commands against Collector data
- [ ] Local surface states clearly that triage (status, Investigations) is cloud-only for now
- [ ] Covered by the existing CLI integration-test pattern

## Desktop app triage parity (deferred with local writes)

**What to build:** Once the Collector grows a counterpart events table, the desktop app's errors page gains the same triage surface as the web app: Status badges and filter, the event timeline, status controls, and the Investigation form, all against the Collector via the shared explorer components (the ErrorDetail triage seam already exists). Deferred together with local triage writes (ADR 0004); until then the desktop errors page keeps its current read-only behavior.

**Blocked by:** Status events with badges and filter; a Collector counterpart of the events table (not yet scheduled).

- [ ] Desktop errors list shows Status badges and filter
- [ ] Desktop Error detail shows the timeline with attribution and status controls
- [ ] Investigations written from the desktop app land in the Collector and appear in local CLI reads
- [ ] Verified manually on the desktop app
