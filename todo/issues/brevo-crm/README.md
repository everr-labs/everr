# Brevo CRM: commit-sized implementation tasks

Status: task 00 is independently reviewed and committed as `8a9145de2`. Task 01
is implemented, independently reviewed, and committed as `c4dca85c1`. Task 02 is
implemented, independently reviewed, and committed as `9696b6ce5`. Task 03 is
implemented, independently reviewed, and committed as `361211ba8`. Task 04 is
implemented, independently reviewed, and committed as `b3b617cdc`. Task 05 is
implemented, independently reviewed, and committed as `f0bbeef65`. Task 06 is
implemented and independently reviewed, with 53 focused/regression tests and
isolated-provider checks passed; it is ready for commit.
Tasks 07 through 16 remain planned.
User, Organization, Membership, billing, Plan, and readiness source facts are wired;
no CRM subscribers or handlers are enabled.

Source: [integration plan](../../../docs/brevo-crm-integration-plan.md), based on
`chore/worker-separation` at `aed99bc42`. The active implementation branch is
`feat/crm-utilities`.

Each ticket defines one proposed commit, including its own meaningful checks.
Dependencies must land first; individual commits are not promised to cherry-pick
onto a tree without their prerequisites. Commit messages are suggestions in
English. This breakdown does not create commits or authorize production activation.

## Fixed decisions

- Domain publication is `events.publish(event): void`, fire and forget after a successful
  source commit. Failure to save an event/consumer job is reported only through
  nonthrowing telemetry and never changes the main operation's result.
- No UnitOfWork, transaction parameter in publication, or generic event outbox.
  Critical pre-existing provisioning and billing commands keep their guarantees.
- Graphile retries begin once a consumer job is persisted. Reconciliation repairs
  current CRM state after lost notifications, without inventing historical events.
- Shared modules own their business facts; only cloud registers Brevo handlers.
- Activation requires queryable own data plus a first useful consultation in the
  same Organization. Readiness, current activity, and Plan remain distinct.
- Preserve unrelated changes. Do not automatically generate migrations. Never add
  tests that only assert YAML text. Follow all applicable AGENTS.md instructions.

## Execution ledger

Start from `feat/crm-utilities` at
`aed99bc42859cbabf1e75898abb1e3d49a3bce3a`. Preserve pre-existing local work,
including unrelated research, skills, and scripts. Execute tickets sequentially:
each implementation agent hands its scoped result to a separate review-and-fixes
agent before the coordinating agent commits and advances to the next ticket.

| Task          | Implementation                                                     | Independent review                                                | Commit        |
| ------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------- |
| 00            | Complete; scoped documentation checks passed                       | Complete; findings fixed and checks repeated                      | `8a9145de2`   |
| 01            | Complete; checks and isolated ingestion passed                     | Complete; strict-schema finding fixed and checks passed           | `c4dca85c1`   |
| 02            | Complete; source, PostgreSQL and regression checks passed          | Complete; no material findings; 133 regression tests passed       | `9696b6ce5`   |
| 03            | Complete; source, PostgreSQL and provisioning checks passed        | Complete; multi-match mutation finding fixed and verified         | `361211ba8`   |
| 04            | Complete; 98 focused persistence and regression tests passed       | Complete; no material findings; 98 tests passed independently     | `b3b617cdc`   |
| 05            | Complete; 16 focused snapshot/storage and entitlement tests passed | Complete; no material findings; 16 tests passed independently     | `f0bbeef65`   |
| 06            | Complete; 42 tests and isolated-provider checks passed             | Complete; quota/body cancellation findings fixed; 53 tests passed | Not committed |
| 07 through 15 | Planned                                                            | Not started                                                       | Not committed |
| 16            | Optional design only, planned                                      | Not started                                                       | Not committed |

Update this ledger and the affected ticket with actual evidence after each
stage. An implementation checkmark alone does not mean a ticket is reviewed or
committed. Keep task 16 outside the active CRM implementation and rollout.

## Commit sequence

| Task                                                  | Commit scope                                                     | Prerequisites | Repository     |
| ----------------------------------------------------- | ---------------------------------------------------------------- | ------------- | -------------- |
| [00](tickets/00-planning-baseline.md)                 | Record the agreed integration plan                               | None          | `everr`        |
| [01](tickets/01-best-effort-publisher.md)             | Add the typed fire-and-forget publisher                          | 00            | `everr`        |
| [02](tickets/02-user-events.md)                       | Publish committed User lifecycle facts                           | 01            | `everr`        |
| [03](tickets/03-organization-membership-events.md)    | Publish Organization and Membership facts                        | 02            | `everr`        |
| [04](tickets/04-cloud-billing-readiness-events.md)    | Publish cloud billing, Plan, and readiness facts                 | 03            | `everr`        |
| [05](tickets/05-crm-projection-state.md)              | Add cloud CRM projection state and snapshot mapping              | 00            | `everr`        |
| [06](tickets/06-brevo-http-adapter.md)                | Implement the Brevo HTTP adapter and request budgets             | 05            | `everr`        |
| [07](tickets/07-user-sync-worker.md)                  | Synchronize Users through a cloud integration runner             | 02, 06        | `everr`        |
| [08](tickets/08-organization-association-sync.md)     | Synchronize Organizations and Membership associations            | 03, 04, 07    | `everr`        |
| [09](tickets/09-deletion-cleanup.md)                  | Handle deletion and stale remote mappings                        | 08            | `everr`        |
| [10](tickets/10-activation-milestones.md)             | Persist verified activation milestones and sync their fields     | 01, 05, 08    | `everr`        |
| [11](tickets/11-query-value-observations.md)          | Observe useful consultation across UI, CLI, and MCP              | 10            | `everr`        |
| [12](tickets/12-resumable-bootstrap.md)               | Add resumable CRM bootstrap                                      | 09, 11        | `everr`        |
| [13](tickets/13-periodic-reconciliation.md)           | Repair CRM drift after lost events                               | 12            | `everr`        |
| [14](tickets/14-operational-readiness.md)             | Document and prove CRM operational readiness                     | 13            | `everr`        |
| [15](tickets/15-deployment-configuration.md)          | Configure Brevo for the deployed cloud application               | 14            | `everr-deploy` |
| [16](tickets/16-optional-campaign-delivery-design.md) | Plan optional historical event delivery for campaigns (optional) | 14            | `everr`        |

## Dependency and rollout notes

Tasks 01 through 04 introduce generic publication and its source facts. Tasks 05
and 06 establish the cloud projection and provider adapter, so they need not wait
for every source event to be wired. Task 07 is the first complete live projection
slice, from a User event through a cloud runner to a Brevo contact. Task 08 extends
it to companies and Memberships; task 09 completes deletion recovery.

Tasks 10 and 11 add the agreed activation behavior. Task 12 imports existing
accounts; task 13 repairs changes lost before job persistence. Do not enable live
production synchronization until tasks 01 through 14 are complete, the required
schema and Brevo fields are ready, and the separate infrastructure change in task
15 has been reviewed. Earlier implementation commits keep the integration disabled
by default and can be exercised with isolated test configuration.

Task 15 belongs to the sibling `everr-deploy` repository and must be a separate
commit there. It must not accidentally bundle infrastructure with application
changes. Actual production enablement follows the authorized rollout; a commit
alone does not apply configuration or migrations.

Task 16 is a separate specification for future campaigns. It does not block the
CRM projection and does not enable historical event exports or send emails.

## Review rule for each commit

A commit is complete only when the ticket's behavior works against its declared
prerequisites, targeted checks pass, required manual verification is recorded,
and telemetry introduced by the change has been verified with Everr. Missing
external credentials or unresolved provider behavior must be recorded explicitly,
not counted as successful verification. No placeholder implementation should be
presented as a finished projection just to reduce the number of commits.
