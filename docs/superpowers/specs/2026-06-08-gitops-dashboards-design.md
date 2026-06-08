# Gitops-only dashboards — design

## Summary

The dashboarding feature changes direction to **gitops-only**. Git becomes the
single source of truth for dashboard definitions; all click-based editing is
removed. The everr app becomes read-only — it renders dashboards and runs their
queries but never mutates specs. The only writer is a new CLI command,
`everr dashboards apply`, intended to run from CI (or by a human). Postgres
becomes a projection of what has been applied rather than an editing store.

This is the "B now, A later" path:

- **Now (B):** dashboards live in any git repo the customer controls; their CI
  runs an apply command that reconciles specs into everr. Git is the source of
  truth by convention; everr receives.
- **Later (A):** a server-side webhook sync watches a customer's connected repo
  and calls the *same* reconcile logic with the *same* token-equivalent
  credential. The design below is chosen so that layering on the webhook model
  requires no re-architecting.

## Goals

- Remove every click-based mutation surface from the dashboard UI.
- Make git the complete desired state for an org's dashboards.
- Support dashboards contributed by **multiple independent repos** without one
  repo's changes clobbering another's.
- Keep the read path intact: rendering, variable selection, query execution.

## Non-goals

- Webhook-driven sync from a customer's own repo (future "A").
- Migration/export of existing dashboards. The feature is in active development
  with no production data to carry over.
- Any in-app authoring, scaffolding, or "eject to YAML" tooling.

## Architecture & data flow

```
git repo (Perses YAML/JSON, directory tree)
        │  CI runs:  everr apply ./dashboards --source=platform
        ▼
apply endpoint (authenticated by API token → org)
        │  source-scoped declarative reconcile (create / update / prune)
        ▼
Postgres `dashboards` (projection)  ──read──▶  app renders & runs queries
```

The app reads from the Postgres projection exactly as it does today. Only the
write path changes: instead of in-app server functions mutating rows, a single
reconcile path driven by the CLI owns all writes.

## File format & directory convention

- Dashboards are Perses `Dashboard` documents — `kind: Dashboard`, `metadata`,
  `spec` — the same shape the store already holds.
- **Both YAML and JSON are accepted.** YAML is the human-authoring default.
- **Directory structure = folder path.**
  `dashboards/platform/latency/overview.yaml` → folder `Platform / Latency`,
  dashboard name `overview`. Folder display names are derived from path segments
  (titleized).
- **Folders are derived, not owned.** A folder "exists" because one or more
  dashboards declare a path into it; the browse tree is computed from dashboard
  membership; an empty folder simply disappears. There are no folder objects to
  reconcile and no folder ownership to contend over — so two different sources
  can place dashboards into the same folder without conflict.

## Identity & multiple sources

The central constraint: dashboards come from multiple repos, and a naive
"reconcile the whole org to this tree, prune everything else" would let one
repo's apply delete another repo's dashboards.

Solution — **source-scoped reconcile** (the kubectl ApplySet / ArgoCD
Application / Flux Kustomization pattern):

- Every apply belongs to a named **source**, declared via `--source=<id>` (or a
  repo-root `everr-dashboards.yaml` manifest carrying `source:`).
- Every dashboard row records the source that owns it.
- Reconcile and prune only ever touch dashboards owned by the applying source.
  Other sources are invisible to the apply.

- **Identity is namespaced: `source/name`.**
  - `name` comes from `metadata.name`, falling back to the filename.
  - Same-named dashboards from different sources coexist
    (`platform/latency`, `payments/latency`).
  - A duplicate name *within a single source* is a loud apply error.
- **Source** vs **folder** are orthogonal: source = prune/ownership scope;
  folder = display grouping. A dashboard owned by source X and one owned by
  source Y can both declare `folder: Platform/Latency` and sit side by side;
  X's prune never touches Y's dashboard in that folder.

## Reconcile / prune semantics

`apply --source=X <dir>` means "make source X's dashboards exactly match this
tree":

- **Create** dashboards present in the tree that don't yet exist.
- **Update** dashboards that changed, **preserving unknown Perses fields**
  (the open → edit → save round-trip behavior recent commits already protect).
- **Delete** dashboards owned by X that are absent from the tree — **only X's**,
  never another source's. This happens **by default**: the tree is the complete
  desired state, so a removed file removes the dashboard. There is no opt-in
  prune flag; deletion is part of normal reconcile, made safe by the fact that
  it is source-scoped and transactional.

Guardrails:

- `--dry-run` prints the create/update/delete diff and exits without writing.
- An apply invocation is **transactional**: all-or-nothing. A mid-batch failure
  rolls the whole apply back.

## CLI & authentication

**Implemented command (top-level, not a subcommand group):**

- `everr apply <dir> --source=<id> [--dry-run]`

There is no `everr dashboards apply`, no `list`, and no `delete` sub-command.
The apply command is the single reconcile entry-point; deletion is implicit
when a file is absent from the tree.

A repo-root `everr-dashboards.yaml` manifest can carry `source:` (and
optionally a default directory) so CI does not repeat flags.

**Authentication:**

- The CLI reads `EVERR_API_TOKEN` (key) and `EVERR_API_URL` (base URL) from
  the environment and sends the key as `Authorization: Bearer <key>`.
- Org-scoped **ingest** keys (`ek_` prefix) are accepted today. Accepting
  additional key types is an append to `APPLY_KEY_CONFIGS` in
  `packages/app/src/data/dashboards/apply-auth.ts`.
- The apply endpoint also accepts the `x-api-key` header, or a live
  interactive session as a fallback for human use.

The CLI is Rust (`everr-cli`) and already has device-code login
(`everr cloud login`) producing a stored session + bearer token, an
`ApiClient` for authenticated calls, and a server that derives org from the
session's `activeOrganizationId`. Interactive apply uses that session; CI uses
`EVERR_API_TOKEN`.

## Generic apply (kind registry)

The server endpoint `POST /api/apply` is **kind-generic**. Each document in
the tree carries a `kind` field; the server dispatches it through a registry:

- `Dashboard` is registered today.
- New kinds (e.g. `Alert`) are added **server-side only** — no CLI change
  needed. The CLI is an envelope carrier; it does not know or care what kinds
  exist.
- **Unknown kinds are rejected** — the entire apply fails with a 400 and an
  error naming the unknown kind and the offending file; nothing is written.
- A source reconciles **all registered kinds** against the tree. If a
  kind has no documents in the tree it is pruned for that source (all existing
  rows for that kind + source are deleted). To manage kinds independently
  use separate `--source` values (e.g. `--source=platform-dashboards` vs
  `--source=platform-alerts`).

## Schema changes

- `dashboards`:
  - Add `source text not null`.
  - Change uniqueness from `(organization_id, slug)` to
    `(organization_id, source, name)`. Identity becomes `source/name`.
  - Replace folder linkage with a `folder_path text` column, derived from the
    file's directory at apply time. The browse tree is computed from these
    paths at read time; empty folders do not exist as rows.
  - `updated_at` bumps on apply; `created_at` stays.
- **Drop folder objects:** remove the `dashboard_folders` table, the
  `dashboards_folder_fk` foreign key, and `folder_id`.

(Per project convention, do not generate Drizzle migrations while iterating on
the schema.)

## What gets removed

All mutation surfaces.

Server functions to delete: `saveDashboard`, `createDashboard`,
`renameDashboard`, `moveDashboard`, `deleteDashboard`, and every folder server
function (`createFolder`, `renameFolder`, `moveFolder`, `deleteFolder`,
`listFolders`).

UI to delete: `panel-edit-page`, `query-editor`, `viz-options`, the
`settings-*` sections, the json/sql/code editors, `folder-picker`, the
name/delete dialogs, dashboard-tree edit affordances, the dirty-state
machinery, `variable-draft`, and the `/new`, `/$dashboardId_/settings`, and
`/$dashboardId_/panel/$panelKey` routes.

What stays: the dashboard grid, panel rendering, the variable **bar** (runtime
selection), query execution (`runPanelQuery`, `runVariableOptionsQuery`), and
read-only routing.

## Routing changes

Dashboard URLs reflect namespaced identity (`source/name`), e.g.
`/dashboards/platform/latency-overview`. The not-found UI is reused for unknown
source/name combinations (existing bad-slug handling extends naturally).

## Testing

Heaviest coverage on reconcile:

- Source-scoped prune isolation — source X's apply never creates, updates, or
  deletes source Y's dashboards.
- Namespaced collisions — cross-source same-name coexists; in-source duplicate
  errors.
- `--dry-run` diff correctness.
- Unknown Perses field preservation through apply.
- Transactional rollback on a mid-batch failure.

Plus: CLI parsing + manifest resolution; API-token auth (valid / expired /
wrong-org). Read-path and render tests largely survive; mutation tests are
deleted alongside their features.

## Apply auth (implemented — plan 2)

`applyDashboards` authenticates non-interactively via an API key, or falls back
to the interactive session. The key is read from `Authorization: Bearer <key>`
(or the `x-api-key` header). Accepted key type today: the org-scoped **ingest**
key (`ek_` prefix); the key's organization is the apply target. The everr CLI
(plan 3) sends its token in this header (`EVERR_API_TOKEN`).

Accepting additional key types later (user-scoped `cli` keys, or a dedicated
`deploy` key) is an append to `APPLY_KEY_CONFIGS` in
`packages/app/src/data/dashboards/apply-auth.ts`; user-referenced keys will also
need an org-resolution branch there.
