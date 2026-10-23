# 15: Configure Brevo for the deployed cloud application

Status: planned. This ticket is not implemented.

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

- [ ] The infrastructure change is committed in everr-deploy, separately from application commits.
- [ ] Self-hosted deployments remain independent of Brevo credentials and CRM tables.
- [ ] Rollout and rollback/pause steps preserve queued work; enabling production is an explicit rollout action.
- [ ] Required schema and field setup are confirmed before enabling consumers.

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
