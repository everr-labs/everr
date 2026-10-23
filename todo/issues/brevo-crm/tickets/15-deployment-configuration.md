# 15: Configure Brevo for the deployed cloud application

Status: configuration preparation implemented, independently reviewed and committed
as `1df983b` on sibling `everr-deploy` branch `codex/brevo-crm`. Production remains
disabled. Target deployment, schema/field proof and runtime rollout are pending.

Repository: `everr-deploy`.

Depends on: [14: Document and prove CRM operational readiness](14-operational-readiness.md).

Suggested commit: `feat(infra): configure opt-in Brevo CRM synchronization`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- In the sibling repository, add cloud-only secret references, non-secret integration configuration, and deployment instructions.
- Deploy only a compatible application build with required schema changes applied through the repository's existing process. Never auto-generate migrations.
- Start disabled or paused, validate configuration and fields, bootstrap a small batch, then enable live synchronization in the authorized rollout.
- Keep Brevo credentials server-only and separate production from development/test identities or accounts.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `../everr-deploy/infra-v2/app.tf`
- `../everr-deploy/infra-v2/variables.tf`
- `../everr-deploy/infra-v2/setup.sh`
- `../everr-deploy/infra-v2/.env.1p`
- `../everr-deploy/infra-v2/README.md`

## Acceptance criteria

- [x] The infrastructure change is committed in everr-deploy, separately from application commits.
- [x] Self-hosted deployments remain independent of Brevo credentials and CRM tables.
- [x] Rollout and rollback/pause steps preserve queued work; enabling production is an explicit rollout action.
- [ ] Required schema and field setup are confirmed before enabling consumers.

The final unchecked criterion is an actual target rollout gate. It was not
satisfied by preparing configuration or by task 14's isolated test-account proof.

## Verification in this commit

- Use the existing infrastructure formatting/validation process and inspect the scoped plan without exposing secrets.
- Verify cloud-only injection and paused/disabled behavior, then validate actual sync during the authorized rollout.
- Do not add tests that only assert YAML text contents.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.

## Reviewed configuration and verification

The six committed infrastructure files are `infra-v2/.env.1p`,
`infra-v2/.env.crm.1p`, `infra-v2/app.tf`, `infra-v2/variables.tf`,
`infra-v2/setup.sh` and `infra-v2/README.md`. They add cloud-server-only conditional
secret injection, validated nonsecret settings and disabled-default local setup.
No application source, workflow, image, real tfvars/state or schema was changed.

OpenTofu formatting and full provider-schema validation passed, plus 19 isolated
plans extracted from the actual HCL and 6 stubbed setup cases. Independent review
reran these checks and fixed the rollout wording: a bounded bootstrap limits that
command's admission, not configured-mode outbound scope. Configured mode consumes
backlog/live work and scans current state. Evidence remains in
`.verify-everr/artifacts/task15-deployment-configuration/`.

There was no full target-environment plan, apply, secret fetch, production sync or
target canary. Before any enabled apply, adopt the optional key in every relevant
CI planning/applying entry point and record durable nonsecret settings. Then
verify a compatible build, the full reviewed target schema, exact target field
inventory/canary, paused admission and reviewed real plan before explicit
configured rollout. Task 14's actual provider proof covers owned fixtures in an
isolated account only. These remaining gates do not invalidate the reviewed
configuration preparation, and remain required for completing the target rollout.
