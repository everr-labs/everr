# 14: Document and prove CRM operational readiness

Status: implemented and independently reviewed, awaiting coordinator commit.
The focused isolated exercise and corrected real provider canary passed. Task 13
is committed as `f23e32eeb`. Production remains disabled.

Repository: `everr`.

Depends on: [13: Repair CRM drift after lost events](13-periodic-reconciliation.md).

Suggested commit: `fix(crm): verify company names and document operational readiness`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Document configuration, field provisioning, schema prerequisites, pause/resume, bootstrap, reconciliation, and exhausted-job recovery.
- Run a complete isolated integration exercise and capture verification evidence rather than postponing all testing to this task.
- Update background-work ownership/guarantees to match the implemented fire-and-forget publisher and cloud runner.
- Keep optional campaign delivery outside this rollout. Record provider-contract checks and any remaining blockers.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `docs/background-work.md`
- `docs/brevo-crm-integration-plan.md`
- `packages/cloud/README.md`
- `docs/`

## Acceptance criteria

- [x] Evidence covers password/OAuth signup, User update, multi-Organization relationships, downgrade, cancellation state, activation, deletion, and repair.
- [x] A forced event-save failure leaves the User created and produces a diagnostic visible in Everr.
- [x] Paused/failed Brevo does not break signup, consultation, billing, or provisioning.
- [x] Manual app checks use main-worktree .auth when available; missing credentials are documented rather than treated as a pass.

## Verification in this commit

- Focused end-to-end exercise in an isolated Brevo account and Everr stack.
- Inspect the changed modules' existing targeted test results and record manual verification evidence.
- Review source/migration prerequisites and safe rollout order before task 15.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.

## Implementation evidence and deliberate limits

The [operations runbook](../../../../docs/crm-operations.md) is the current
configuration, complete schema prerequisites, provider-field inventory/readback
gate, namespace/account invariant, lifecycle, bootstrap, periodic repair,
diagnosis, guarded recovery and staged rollout/pause contract. Background-work
and cloud/module READMEs now point to that contract and describe the implemented
best-effort publisher and independent CRM runner. Historical transactional CRM
publication and first-ingestion activation proposals were removed from the
background-work document. Task 13's committed identity is recorded as `f23e32eeb`.

No automatic preflight was added. A manual inventory must verify all three Contact
normal attributes (two text, one boolean) and all eleven Company text attributes
with exact labels/internal names. A real owned Contact/Company canary must then
verify every value, standard Company name, boolean transition, nullable clearing,
explicit pair and email suppression by exact-record readback. Brevo can silently
ignore unknown fields. Configuration, 2xx and a local synced revision are not a
substitute for that gate. Target schema delivery and target-account field/canary
proof remain required before task 15 enablement; no application migration was
generated or applied here.

The first ticket 14 canary failed honestly: all 14 metadata definitions, all
custom field values and Contact false-to-true verification read back correctly,
but the standard Company name was absent from the adapter result. Brevo returns
it in `attributes.name`; the earlier adapter expected a top-level value. That
could cause redundant name PATCHes in otherwise unchanged repair cycles. Both
owned fixtures were cleaned and exact lookups returned 404. The adapter now
normalizes the real provider shape, retains older top-level compatibility and
keeps the standard name separate from custom attributes. Two behavioral
regressions cover exact read/no-op, name-only PATCH, inventory recovery and 200
update parsing. The first failed proof and its cleanup evidence are retained,
not counted as passed.

Focused isolated evidence is retained in
`.verify-everr/artifacts/task14-operational-readiness/` with exact proof source,
command output and a report. The exercise is layered across real source
persistence, current PostgreSQL/Graphile synchronization and repair, actual OTel
export into isolated Everr, and a small real Brevo field canary. It is not an
authenticated HTTP/browser/Google/Polar customer journey.

- Password signup and updates use actual Better Auth persistence. OAuth uses
  Better Auth `internalAdapter.createOAuthUser`, not an external Google browser
  sign-in. Shared identity/consultation checks passed 56 cases; three PostgreSQL
  concurrent-writer cases were skipped in that embedded run and are not counted.
- Billing/downgrade/readiness source suites passed 78 cases with controlled Polar
  and ClickHouse provider seams. They distinguish scheduled cancellation,
  inactive Pro access and actual Hobby downgrade, and preserve committed source
  results if publication throws. Source persistence failures remain real errors.
- Six actual PostgreSQL milestone cases passed separately, including committed
  once-only markers, unknown history, lost publication repair and a real marker
  database-lock failure that leaves the successful action intact. The initial
  no-database invocation skipped these six and is not counted as a pass.
- The current 64 PostgreSQL/Graphile cases passed with real Everr export, and
  passed again after the adapter correction. They cover multi-Organization pairs,
  deletion/cascades, lost source events, owned-field/pair drift, mapped-missing
  blocks, paused/disabled behavior, cadence/backpressure, retained terminal jobs,
  retry budgets and guarded recovery. Provider transport is controlled in these
  worker cases. Earlier actual multi-Company/cleanup proofs in tasks 08/09/12
  remain part of the evidence, without rerunning broad provider CRUD.
- A fresh actual Better Auth committed signup survived forced consumer enqueue
  failure. A controlled adapter 500 produced a persisted 60-second retry and
  then success. Isolated Everr readback found one subscriber-failure log, one
  User retry and one User synced log; current repair produced progress, drift,
  missing and failure logs plus the counter (unit `1`) and pending-age gauge
  (unit `s`). No telemetry event, attribute, metric or exporter changed.
- The corrected adapter suite passed 44 cases. Cloud TypeScript and scoped
  lint/format/diff checks are recorded in the report. Fallow's enforced dead-code,
  dependency, circular and boundary categories are zero. Its full all-gates audit
  remains non-green due to two inherited adapter complexity findings (maximum
  cyclomatic 26); no suppression or unrelated refactor was added.

`.auth` is absent in the main worktree, so authenticated manual app checks were
skipped under AGENTS.md, not passed. Real Google/Polar credentials are absent;
no external sign-in, billing charge or fake session was used. Current activation
coverage and externally scripted/unmarked-synthetic limits remain conservative.
Campaign delivery, production ingestion/enablement, target schema application,
provider mapping replacement and ordinary blocked-revision reset remain outside
this proof. No sibling infrastructure was written.

## Final provider gate and handoff

The corrected small canary passed: inventory 3 Contact plus 11 Company names/types,
Contact verification false-to-true with email suppression, all eleven Company
custom values, standard name after create and rename PATCH/readback, nullable
clearing to empty text, explicit association and an unchanged post-read update
with zero HTTP writes. Marker `task14-3f15adb0-0ecf-4afc-b323-678bad9a37ce`.
It used 17 actual requests over the same persisted budget database/account as the
first attempt. Only one marked Contact and Company were created per attempt;
both attempts cleaned their fixtures and exact lookups confirmed 404. Required
field definitions remain unchanged. Email-only fixtures do not prove real
phone-based SMS suppression. Source policies are established by the separate
source/worker suites, not by the adapter field canary.

The complete packet records 250 distinct passing behavior cases across layers
(the repeated 64-case post-fix worker execution is not double-counted), plus three
explicit embedded-run PostgreSQL concurrency skips. The full audit remains
non-green only for the disclosed inherited adapter complexity findings. Scoped
formatting, lint, TypeScript, local Markdown link and diff checks pass.

All temporary source-discovery proof files were removed. The owned isolated
Everr runtime and `everr-task14-pg-20261023` container were removed after readbacks;
cleanup evidence and proof sources remain under the ignored artifact directory.
No schema migration, production setting, campaign, external Google/Polar flow or
sibling deployment write occurred. Actual target build/schema delivery, field
inventory/canary proof and target telemetry ingestion remain rollout prerequisites.
Independent review is complete and no task 14 commit exists yet.

## Independent review

Standards and Spec review found no material defects. The Company parser matches
the provider's documented nested response shape, preserves legacy top-level reads
and keeps the top-level write contract. The exact 11-file scope and retained proof
sources/readbacks were inspected; the initial failed canary, explicit skips and
layered provider/source boundaries remain disclosed. The transactional helper
wording in background-work was clarified without changing its guarantee.

All 44 adapter cases passed independently. Both documented source-checkout `tsx`
commands loaded and rejected disabled mode before database/provider work. This
checks command usability and the mode guard, not target database admission.
No provider canary or broad integration suite was repeated. No functional,
telemetry, schema, migration or production change was needed during review.
