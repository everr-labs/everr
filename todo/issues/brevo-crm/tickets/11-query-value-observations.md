# 11: Observe useful consultation across UI, CLI, and MCP

Status: planned. This ticket is not implemented.

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

- [ ] A supported successful consultation can activate only its actual authorized Organization.
- [ ] A multi-panel dashboard or refresh does not create multiple first-use milestones.
- [ ] CLI and MCP can establish activation without a browser or fabricated User.
- [ ] Self-hosted requires no cloud milestone persistence or CRM dependency.

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
