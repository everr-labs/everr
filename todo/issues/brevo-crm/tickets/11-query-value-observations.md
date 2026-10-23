# 11: Observe useful consultation across UI, CLI, and MCP

Status: implemented and independently reviewed with conservative trace-detail
coverage. Two findings fixed; 120 checks and both package type checks passed.
Isolated marker/ingestion proof retained. Committed as `827cd6b51`.

Repository: `everr`.

Depends on: [10: Persist verified activation milestones and sync their fields](10-activation-milestones.md).

Suggested commit: `feat(product): observe useful customer telemetry consultations`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Wire the shared observation interface into actual query capability completion paths for authenticated UI, CLI, and MCP.
- Derive Organization, actor when known, surface, capability, and customer-data evidence on the server.
- Map the plan's candidate useful actions to current server completion paths and document the accepted evidence for each surface.
- Exclude probes, SELECT 1, TestData/demo data, internal telemetry, automatic backfill, polling, empty dashboards/results without own-data evidence, and redundant dashboard panel refreshes.
- Keep publication/observation fire and forget and avoid raw SQL/results or customer payloads in external events.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/app/src/data/dashboards/`
- `packages/app/src/data/mcp/`
- `packages/app/src/routes/api/cli/`
- `packages/app/src/data/`
- `packages/cloud/src/app/composition/`

## Acceptance criteria

- [x] A supported successful consultation can activate only its actual authorized Organization.
- [x] A multi-panel dashboard or refresh does not create multiple first-use milestones.
- [x] CLI and MCP can establish activation without a browser or fabricated User.
- [x] Self-hosted requires no cloud milestone persistence or CRM dependency.

## Verification in this commit

- Behavioral tests at the query completion seam for all three surfaces and excluded actions.
- Manual isolated app checks using .auth when available; prove accepted and rejected activation paths.
- Verify resulting diagnostics and telemetry ingestion through Everr.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.

## Implementation and supported scope

The [capability coverage contract](../../../../packages/cloud/src/organizations/README.md#supported-completion-paths-task-11)
is authoritative. UI standalone trace navigation has a separate completed-read
operation; preloading and ordinary viewer refresh reads never observe. CLI SQL
and MCP query observe only the full-match raw trace-detail SQL subset, and only
successful returned own Production/CI rows with stored provenance evidence.
All three reuse the verified current Membership from existing authorization.
Current CLI SQL and MCP OAuth are Member-backed; no new client grant or invented
User was added. The shared completion module also preserves the existing real
Organization-client principal contract.

Dashboard rendering is not implemented. Panels, TestData, automatic dashboard
refresh and empty dashboards cannot produce observations, which satisfies the
nonduplication criterion without claiming a rendered dashboard consultation.
Log, error and CI-run detail endpoints and generic SQL remain unsupported.
Known automatic list/status/watch reads and UI preload/refetch paths are excluded.
External scripts deliberately repeating the identical authorized detail operation
cannot be distinguished from that operation at HTTP level; no browser assertion
or request flag is treated as authority. Stored telemetry's origin/provenance
conventions cannot identify unmarked or falsely labeled synthetic data.

Evidence inspection is synchronous and bounded to at most 1,000 records. It adds
no query, authentication lookup, network call or asynchronous queue. Marker work
still uses task 10's 32 in-flight limit and 3-second drain. Unexpected completion
failures emit a guarded fixed diagnostic with one bounded `everr.*` attribute.
Shared queries import no cloud persistence or CRM code. No query was rewritten,
no tenant predicate added, and no application migration generated or applied.

## Implementation verification

- 117 behavioral cases passed across 8 app files: actual UI/CLI/MCP completion
  handlers, authorization context, exact grammar and alias spoof rejection,
  origin/provenance exclusions, failed/empty/truncated results, contained observer
  failure, known refresh/prefetch paths and dashboard regressions.
- App and cloud TypeScript checks passed. Scoped formatting/lint and audit results
  are retained in the ignored evidence report. Formatting/lint passed. Fallow
  reports zero dead-code/dependency/boundary/circular issues; its advisory audit
  exits 1 with five complexity findings (absent/stale coverage) and five
  duplication groups, so the full audit is not claimed green.
- A fresh fixture trace entered an owned isolated Everr collector through OTLP
  (HTTP 200), then was read through the actual CLI. Those stored nested JSON rows
  drove the completion seam with fixture authority and a disposable embedded
  PostgreSQL store: three markers (UI/CLI/MCP), six milestone facts despite repeat
  consultations, equal queryable/activated times, one unknown Organization.
- One forced completion failure produced a fresh ingested
  `organization.consultations.failed` log, read back through Everr. Its only
  attribute was `everr.consultation.failure_stage = completion`; no SQL, customer
  payload, trace ID or exception text was exported.
- This is completion-seam, marker-DB and ingestion proof. An authenticated browser
  or HTTP journey was not run: `.auth` is absent, so the manual app check was
  skipped under AGENTS.md. No rendered-UI claim is made. Production is unverified.
- Owned collector ports, processes and temporary telemetry data were cleaned up.
  Proof artifacts remain under `.verify-everr/artifacts/task11-query-value-observations/`.

## Independent review

Standards: no material documented-standard violations or module-design findings.
Shared completion uses the existing authorization and composition seams; no cloud
imports, migrations, tenant predicates or React state synchronization were added.

Spec: two reproduced findings fixed. Empty, boolean or null current environment
attributes no longer fall back to a legacy `production` value. The standalone
trace route sets `preloadStaleTime: 0`, so a skipped preload cannot suppress its
actual navigation loader. `ensureQueryData` still avoids additional reads for
cached details; ordinary viewer reads and embedded viewers remain unobserved.

Three added provenance cases failed before the fix and passed after it. The
installed TanStack router regression reproduces preload followed by navigation,
asserting zero preload reads and exactly one navigation consultation. All 120
cases across the original eight files passed independently, as did app/cloud
TypeScript, scoped formatting/lint and `git diff --check`. The diagnostic schema
and exporters are unchanged; the implementation's retained Everr ingestion proof
remains applicable and was not rerun. `.auth` remains absent, so authenticated
manual app verification is skipped. No rendered-UI claim is made.

Independent review is complete with no remaining material findings. This ticket
is not committed.
