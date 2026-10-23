# 10: Persist verified activation milestones and sync their fields

Status: implemented, independently reviewed, and committed as `af9102e69`. Focused checks and isolated ingestion/field proofs passed.

Repository: `everr`.

Depends on: [01: Add the typed fire-and-forget publisher](01-best-effort-publisher.md), [05: Add cloud CRM projection state and snapshot mapping](05-crm-projection-state.md), [08: Synchronize Organizations and Membership associations](08-organization-association-sync.md).

Suggested commit: `feat(crm): track verified organization activation milestones`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Define a typed useful-consultation observation interface without exposing Brevo to query modules.
- Add cloud-owned once-per-Organization milestone persistence with rule version and observation time.
- Require queryable own data plus useful completed consultation in the same authorized Organization; a valid consultation may establish both facts.
- Publish milestone events best effort after marker persistence and project them onto the company.
- Contain ancillary observation/marker failures so successful queries stay successful. Do not auto-generate migrations.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/cloud/src/crm/`
- `packages/cloud/src/db/schema/`
- `packages/app/src/composition/`
- `CONTEXT.md`

## Acceptance criteria

- [x] Concurrent valid observations establish activation once; a later quiet period does not reset it.
- [x] Provisioning, a key creation, positive usage bytes, or subscription alone cannot activate an Organization.
- [x] Observation failure is measured without changing the completed product action's result.
- [x] Lost publication can be repaired from a stored milestone; missing history is not assigned an invented timestamp.

## Verification in this commit

- Behavioral storage tests for concurrency, accepted/rejected evidence, Organization scope, timestamp handling, and marker/publication failure.
- Verify milestone failure diagnostics through Everr.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.

## Implementation evidence

The shared strict `UsefulConsultation` contract requires trusted server completion,
authorized matching Organization scope, own Production/CI provenance and useful
detail/dashboard/interactive CLI/MCP evidence. Nonempty results alone, probes,
`SELECT 1`, TestData/demo/synthetic/internal data, polling, backfill, empty dashboards,
refreshes, provisioning, usage, billing and keys are rejected. Task 11 must derive
this evidence from real server completions; no browser claim is authoritative.
This ticket adds no actual completion hooks and establishes no live action coverage.

Cloud marker persistence is independent of Brevo mode, so future observations
continue during disabled/paused CRM operation. Rule 1 establishes both milestone
times in one once-per-Organization insert, with rule version, winning process
observer start and server admission time after completion. Current action
authorization survives a subsequent Membership departure. Organization-scoped
clients need no invented User. Missing markers stay unknown. Concurrent insertion
publishes both facts only after commit, without actor attribution; latest Company
snapshots recover stored markers after lost publication. Quiet periods never reset
them. No application migration was generated or applied.

Admission reuses the existing bounded fire-and-forget publisher (32 in flight,
3-second drain). Completed actions never await observation. All ancillary failures,
including synchronous clock/diagnostic errors, are contained and measured. Shutdown
drains observations before domain publication, workers and telemetry. A drain
timeout can lose a later publication while a committed marker stays repairable.

Checks passed: 6 actual PostgreSQL marker cases, 33 existing Organization/Membership
PostgreSQL/Graphile regressions plus the new latest Company milestone case,
98 focused cloud cases and 18 app publisher/shutdown/telemetry cases. Both package
TypeScript checks passed. Authenticated manual app checks were skipped because
`.auth` is absent. The real UI/CLI/MCP observation journey belongs to task 11.

Isolated Everr proof: `.verify-everr/artifacts/task10-activation-milestones/`.
`telemetry-proof.stdout` records marker commit and eight forced failure diagnostics;
`cli/task10-freshness`, `task10-keys`, `task10-stages` and `task10-metrics` confirm
fresh ingestion, exactly the bounded failure-stage key, all seven stages and a
monotonic counter with unit `1`. Repeated cumulative metric samples are expected.
Production ingestion was not exercised.

`provider-fields.stdout` confirms three isolated Company text attributes created
with 201 and read back with 200: `everr_first_queryable_at`, `everr_activated_at`,
`everr_activation_rule_version`. Requests respected the existing 36-second general
budget. No provider fixture records, messages, campaigns, lists, invitations or
production state were changed. Existing provider CRUD/association proofs were not
rerun broadly. The external mode-0600 credential remained outside the repository.

Scoped formatting/lint and `git diff --check` passed. Fallow reports zero dead-code,
boundary or dependency issues. Its `--gate all` audit exits 1 with four complexity
findings and 18 duplication groups across touched existing/test code; these are
reported as advisory, not claimed green. Baseline attribution was unavailable
because its temporary-worktree creation was blocked; no worktree was created.

The isolated collector/UI and disposable PostgreSQL container were stopped and
removed. `lsof` confirmed no listeners remain on owned ports 49793, 49794, 49795
or 55441. No default stack or named volume was touched.

Implementation and independent review are complete. Coordinator commit remains pending.
Commit: not created by the implementation or review agent.

## Independent review

Standards: no material violations of AGENTS.md or documented module contracts.
The review checked strict payload copying, the small server observation interface,
cloud-only persistence/provider ownership, bounded admission and diagnostics,
nonthrowing ancillary failure handling, and shutdown ordering. No source changes
or additional regression tests were needed.

Spec: no material missing, incorrect or out-of-scope behavior. The review checked
same-Organization completed-action authorization, accepted own Production/CI
usefulness evidence, rejected non-value actions, atomic once-only markers,
server admission timestamps, post-commit best-effort facts, unknown history,
latest Company repair and independence from disabled/paused Brevo. The contract
can support later server completion hooks without requiring a browser claim or
an invented User. Task 11 remains planned and no hooks were added.

Independent validation passed: 98 focused cloud cases, 18 app publisher/shutdown/
telemetry cases, both package TypeScript checks, scoped lint/format and whitespace
checks. Retained evidence is in `review-cloud.stdout`, `review-app.stdout`,
`review-app-types.stdout`, `review-cloud-types.stdout` and `review-checks.stdout`
under the existing ignored task 10 artifact directory. The implementation's
actual PostgreSQL/Graphile, Everr ingestion and isolated provider field evidence
was inspected and remains applicable because review changed documentation only.
No provider requests, containers, migrations or production operations were run
by review. `.auth` is absent, so authenticated manual app checks remain skipped.
The existing Fallow advisory complexity/duplication findings remain disclosed;
review does not claim that full audit is green.
