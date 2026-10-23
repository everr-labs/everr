# 09: Handle deletion and stale remote mappings

Status: planned. This ticket is not implemented.

Repository: `everr`.

Depends on: [08: Synchronize Organizations and Membership associations](08-organization-association-sync.md).

Suggested commit: `feat(crm): reconcile deleted users and organizations`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Subscribe to deletion facts and clean up only Everr-owned contacts, companies, and associations.
- Preserve mapping/tombstone information through cleanup and implement orphan checks against existing source IDs.
- Make deletion cleanup safe to repeat and prevent older queued upserts from recreating a deleted entity.
- Provide the deletion reconciliation primitive used later by the periodic reconciler.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/cloud/src/crm/`

## Acceptance criteria

- [ ] Cleanup works after the source row has gone, including when its deletion event was lost.
- [ ] An absent remote record is a successful idempotent cleanup outcome.
- [ ] Unrelated contacts/companies and a User's other Organization associations survive.
- [ ] Deletion followed by a new User with the same email does not merge or resurrect the old identity.

## Verification in this commit

- Behavioral tests for missing events, cascades, delete-versus-upsert concurrency, already-deleted remote data, and same-email recreation.
- Manual deletion check using .auth if available and an isolated Brevo account.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.
