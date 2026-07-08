---
"@everr/desktop-app": minor
---

Add `everr resources` to inspect and manage live Cloud resources (dashboards, runbooks, alert rules) directly, alongside the declarative `everr apply`:

- `everr resources list [--kind] [--repoid] [--json]`: list live resources across the organization, with the repoid that owns each one.
- `everr resources show <kind> <slug> [--project] [--json]`: print a resource's stored config (YAML by default, or `--json`).
- `everr resources delete <kind> <slug>`: delete a live resource (non-interactive).
- `everr resources adopt <kind> <slug>`: reassign a resource's repoid to this repository.

`everr apply` now also prints the resolved repoid before the plan.
