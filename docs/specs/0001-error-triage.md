---
title: "Error triage: agent fix handoff, investigations, and resolutions"
status: open
labels: [ready-for-agent]
created: 2026-07-09
---

## Problem Statement

Errors in Everr are read-only. A developer browsing the Errors page can see fingerprint-grouped Errors with their Occurrences, stacktraces, and trace links, but can do nothing about them: there is no way to hand an Error to an Agent to fix, no way to record what was found while investigating, no way to mark an Error resolved or mute a noisy one, and no way to tell whether a resolved Error has regressed. Knowledge about failures lives in chat threads and heads instead of next to the telemetry, and every Error looks equally urgent forever.

## Solution

Make Errors actionable, for Users and Agents at the same level.

From the Errors UI a User picks an Error and gets an agent-agnostic handoff prompt; the Agent pulls full context through a new `errors` CLI surface, fixes the code, and writes its findings back as an Investigation and a Resolution. Everything written about an Error (Investigations, Resolutions, status changes) lives in a dedicated append-only events table keyed by the Error's Fingerprint, with edits and deletes recorded as new version rows so content stays correctable and erasable (see ADR 0004). Every write also projects a metadata-only activity marker into the logs table, so an Agent querying the plain SQL surface discovers triage activity like any other Signal and pivots to the errors read surface for content.

Errors gain a derived Status (open, resolved, ignored) with a version-aware Regression rule: a resolved Error reopens only when an Occurrence arrives from a service version first seen after the Resolution, so same-version stragglers from old deploys do not flap the status.

## User Stories

1. As a User, I want to see each Error's Status as a badge in the errors list, so that I can tell burning problems from handled ones at a glance.
2. As a User, I want to filter the errors list by Status, so that I can focus on open Errors when triaging.
3. As a User, I want to resolve an Error with a markdown explanation of the fix, so that the reasoning is recorded next to the telemetry.
4. As a User, I want to ignore a noisy Error, so that known-irrelevant failures stop competing for my attention.
5. As a User, I want an ignored Error to stay ignored no matter how many new Occurrences arrive, so that muting actually mutes.
6. As a User, I want a resolved Error to reopen automatically when it occurs in a release newer than the fix, so that real regressions surface without manual watching.
7. As a User, I want Occurrences from the same version as the fix (stragglers from old pods or delayed deploys) not to reopen a resolved Error, so that the status does not flap.
8. As a User, I want regressed Errors visibly flagged in the list and on the detail page, so that a failed fix is impossible to miss.
9. As a User, I want to manually reopen a resolved or ignored Error, so that I can undo a wrong triage decision.
10. As a User, I want to write an Investigation on an Error from the web UI, so that partial findings are captured even when no fix exists yet.
11. As a User, I want the Error detail page to show a chronological timeline of Investigations, Resolutions, and status changes, so that I can catch up on everything known about the Error.
12. As a User, I want each timeline entry to show its author, and when an Agent wrote it, which Agent authorized by whom, so that I can judge the provenance of a finding.
13. As a User, I want a handoff action on an Error that copies an agent-agnostic prompt, so that I can paste it into whatever Agent I use and have it start fixing with full context.
14. As an Agent, I want an `errors show` CLI command that returns an Error's full context (message, stacktrace, Occurrences, trace links, existing Investigations), so that I can start diagnosing without reconstructing grouping SQL by hand.
15. As an Agent, I want an `errors list` CLI command with status and service filters, so that I can survey what is currently broken.
16. As an Agent, I want an `errors investigate` CLI command that records my findings as an Investigation (markdown via stdin or file), so that my analysis persists beyond the session.
17. As an Agent, I want an `errors resolve` CLI command that records a Resolution with my explanation, so that the Error's Status reflects the fix I just made.
18. As an Agent, I want `errors ignore` and `errors reopen` CLI commands, so that I can complete triage actions a User asks me for.
19. As an Agent, I want to mark my writes with an agent marker, so that my entries are attributed to me rather than silently to the human whose credentials I run under.
20. As an Agent, I want the errors CLI surface to work against both the Collector and the Cloud, so that I can triage local reproduction errors the same way as production ones.
21. As an Agent, I want triage activity discoverable through the plain SQL query surfaces (metadata markers in the logs table), so that I notice Investigations and Resolutions like any other Signal and fetch their content through the errors read surface.
22. As a User, I want the Everr Skill to teach my Agent the fetch, investigate, fix, resolve loop, so that the handoff prompt works without me explaining the workflow.
23. As a User of the desktop app, I want the same status and investigation capabilities on local Errors, so that the two surfaces behave symmetrically.
24. As a Member of an Organization, I want all Error state strictly tenant-isolated, so that a Fingerprint hash collision with another Organization can never leak or mix triage state.
25. As a User, I want status changes and Investigations timestamped, with edits visibly marked, so that history is never silently rewritten.
26. As a User, I want the errors list to keep working exactly as today when no triage events exist, so that the feature is purely additive.
27. As a User, I want to edit or delete my own Investigations, so that mistakes and accidentally pasted sensitive content are correctable, and erasure requests are honorable.

## Implementation Decisions

- Vocabulary (recorded in the domain glossary): **Error** is the fingerprint-grouped entity, **Occurrence** a single exception log event, **Investigation** an append-only findings record, **Resolution** the event declaring a fix, **Status** the derived triage state (open, resolved, ignored), **Regression** a reopening Occurrence from something newer than the fix. "Issue" is avoided (GitHub collision).
- **Dedicated append-only events table** (`app.error_triage_events`, ADR 0004): rows keyed by tenant, Fingerprint, and entry id, with an event-type column distinguishing investigation, resolved, ignored, reopened, and the markdown body as written. Edits and deletes append version rows (latest wins, deleted entries drop out of reads); the table stores author ids only, with display names resolved from the user profile at read time. A metadata-only materialized view projects each write into the logs table (`ServiceName='error-triage'`, `everr.error.*` attributes, no body, no author) for agent discoverability.
- **Editing and deleting are author-only** in the UI; the timeline marks edited entries. Erasure requests beyond that go through an operational purge on the events table.
- Status is **derived at read time**: latest status event wins, then the Regression rule applies. No mutable store, no stored status column.
- **Regression rule**: an Occurrence reopens a resolved Error iff its `service.version` was first seen (per service, in telemetry) after the Resolution event. An Occurrence with no `service.version` degrades to a plain timestamp comparison against the Resolution. Version ordering is by first-seen time in telemetry, never by semver or SHA comparison. Ignored is sticky: only a manual status change lifts it.
- The Resolution event needs no version field: the rule compares version first-seen time against the Resolution's own timestamp.
- **State is keyed by raw Fingerprint.** A fingerprint-algorithm change orphans attached events; accepted. Derived fingerprints can collide across Organizations, so tenant scoping is load-bearing for correctness, and every query and write is tenant-stamped.
- **Write path is a typed server-side module** over the events table (tenant and author stamped server-side from the session), following the alerts events pattern. The CLI write surface reaches it through an authenticated REST endpoint on the Cloud.
- **CLI surface**: `errors list | show | investigate | resolve | ignore | reopen` under the cloud command family. `show` returns full Error context including the event timeline. Markdown bodies accepted via stdin or file flag. The local command family ships read paths only for now; local triage writes are deferred until the Collector grows a counterpart events table.
- **Attribution**: events record the authenticated User plus an optional advisory agent marker (an `--agent` flag set by the Skill). The UI renders both ("agent, authorized by user").
- **Web UI**: errors list gains status badges and a status filter in the existing search schema, with all statuses visible by default; the Error detail gains a timeline of Investigations/Resolutions/status changes, status controls, an Investigation form, and the copy-handoff-prompt action. Human writes go through a server function emitting the same event shape.
- **Handoff prompt** is agent-agnostic: goal, Fingerprint, and the instruction to run the errors `show` command for full context. No deep links, no per-agent launchers.
- The errors summary read model extends the existing errors repository: status join and Regression rule computed in the summary query. The list must behave identically to today when no triage events exist.
- The Everr Skill is updated to teach the full loop: fetch context, investigate, fix, resolve.

## Testing Decisions

- Good tests here assert external behavior at the seams: the SQL a repository emits and how rows map back, what an endpoint accepts and writes, what a CLI command prints for a given server response. No assertions on internal helpers or intermediate representations.
- **Errors repository seam** (existing fake-execute-client pattern): status derivation, status filter, event timeline query (latest-version resolution, deleted entries dropped), and Regression-rule SQL shape are tested exactly like the current repository tests.
- **Real-ClickHouse integration seam** (new, env-gated and skipped when the env var is absent, mirroring the existing real-Postgres integration test pattern): proves the Regression rule end-to-end with seeded Occurrences, Resolutions, and version first-seen data, including the versionless fallback, same-version stragglers, and sticky ignore.
- **Event-write seam** (existing data-layer test pattern used by alerts): the write module validates input, stamps tenant and author server-side, enforces author-only edits and deletes, and emits the correct version-row shape, with the ClickHouse client mocked.
- **CLI seam** (existing Rust integration-test pattern per command family): the new errors subcommands tested against a stub server, covering list/show output shape and the write commands' request payloads, including the agent marker flag.
- Web UI changes are verified manually against the dev environment; no text-content assertions on prompts or YAML.

## Out of Scope

- Cloud-executed agents, PR automation, or any repo-write machinery: the handoff is to the User's own local Agent.
- GitHub dispatch (filing issues or triggering workflows from an Error).
- An `acknowledged` status or any assignee/ownership concept.
- Agent-specific deep links or per-agent launch buttons.
- A dedicated MCP tool for errors (the MCP `query` tool sees the activity markers; a typed tool can come later).
- Any fingerprint re-linking or migration tooling.
- Local and desktop triage writes (a Collector counterpart of the events table); the local errors surface stays read-only for now.
- Editing or deleting another user's entries, and any admin moderation surface.
- Semver-aware or SHA-aware release ordering.
- Alerting or notifications on Regressions.
- Retention/TTL controls specific to triage events (they follow log retention).

## Further Notes

- ADR 0004 ("Error triage state lives in a dedicated append-only events table") records the storage decision, the rejected alternatives (Postgres row, plain log events, full-content logs projection), and the accepted consequences (metadata-only SQL discoverability, version-append edits, no TTL, tenant policy as a correctness requirement).
- The domain glossary defines all terms used here (Error, Occurrence, Fingerprint, Investigation, Resolution, Status, Regression).
- Triage events carry no TTL: a Resolution must outlive the log retention window. The projected activity markers in the logs table follow log retention like any log row.
- Future features needing their own event history (annotations on traces, deploy markers) follow the same pattern with their own typed tables rather than a shared generic one.
