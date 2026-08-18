# Built-in dashboards are never materialized

Built-in dashboards ship inside the app as a catalog and are served live under the reserved `built-in` pseudo-project. They are openable, read-only Dashboards: nothing is ever copied into an Organization by the UI. The only path to an editable copy is a handoff prompt that has an Agent fetch the definition (`everr resources show dashboard <slug> --project built-in`), adapt it, and apply it as the user's own as-code Dashboard.

## Considered options

- **Materialize on create (template gallery)**: create a live Dashboard from a template in the UI, with provenance tracking and reuse/delete. Rejected: it mints resources that exist in no repository, so apply can never reconcile them, and it needs its own provenance, dedup, and deletion machinery. It also splits editing into two stories (UI-made vs as-code) when the product has exactly one writer: apply.
- **Ship built-ins as pre-applied resources per Organization**: rejected. Copies drift as the catalog evolves, and every Organization pays storage and migration cost for dashboards it may never open.
- **Serve built-ins from a separate API surface**: rejected. The resources API already models kind/project/slug; a pseudo-project reuses the CLI verb, the auth path, and the URL scheme for free.

## Consequences

- `built-in` is a reserved Project name: user resources must be prevented from using it, or a real project would collide with the pseudo-project in routes and the resources API.
- Built-ins update with the app release, for every Organization at once. There is no per-Organization pinning; a catalog change is a product change.
- Write verbs (delete, adopt, apply) must reject the pseudo-project explicitly; only read paths know it.
- An editable copy is a fork, not an instance: once an Agent applies it under the user's Repoid, it has no link back to the catalog and never auto-updates.
