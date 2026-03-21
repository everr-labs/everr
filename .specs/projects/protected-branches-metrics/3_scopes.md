# Scopes

## Data layer — main_branches table and API

- [ ] Add `main_branches` Drizzle schema (`tenantId`, `repository` nullable, `branch`; two partial unique indexes for NULL-safe uniqueness)
- [ ] API: `GET /repos/:repo/main-branches` — list configured branches for a `(tenantId, repository)` pair; returns org-wide rows or hardcoded defaults if none configured
- [ ] API: `POST /repos/:repo/main-branches` — add a branch for a specific repo
- [ ] API: `DELETE /repos/:repo/main-branches/:branch` — remove a branch; returns 422 if it would leave zero rows for that repo
- [ ] API: `GET /org/main-branches` — list org-wide default branches; returns hardcoded defaults if none configured
- [ ] API: `POST /org/main-branches` — add an org-wide default branch
- [ ] API: `DELETE /org/main-branches/:branch` — remove an org-wide default branch; returns 422 if it would leave zero org-wide rows
- [ ] Tests: CRUD for both repo-level and org-level; partial unique constraints; 422 on last delete at each level; resolution order (repo → org → hardcoded)

## Query layer — branch filter for test-overview

*Depends on: data layer above.*

- [ ] Add branch filter to all ClickHouse queries backing the test-overview page
- [ ] Filter uses `main_branches` rows for the current `(tenantId, repository)`; falls back to `['main', 'master', 'develop']` when none configured
- [ ] Filter is omitted when "all branches" mode is active (passed as a parameter, not derived here)
- [ ] Tests: filter applied with config, filter applied with defaults, filter omitted (all branches)

## Test-overview UI — main branches toggle

*Depends on: query layer. Independent of repo settings UI — can be built in parallel.*

- [ ] Add "Main branches / All branches" toggle to the test-overview header
- [ ] Sync toggle state to URL (`?branches=all`); default (no param) is main branches
- [ ] All charts on the page re-fetch with the branch filter when toggle changes
- [ ] Empty state when no runs match the configured branches: "No runs on main branches in this period"

## Repo settings UI — main branches config

*Depends on: data layer. Independent of test-overview UI — can be built in parallel.*

- [ ] Add main branches section to repo settings page
- [ ] List configured branches; show org-wide defaults (or hardcoded defaults) when none configured for the repo
- [ ] Add branch: free-text input, no existence validation
- [ ] Remove branch: `[×]` button disabled on last remaining entry

## Org settings UI — main branches defaults

*Depends on: data layer. Independent of test-overview UI — can be built in parallel.*

- [ ] Add main branches section to org settings page
- [ ] List org-wide default branches; show hardcoded defaults (`main`, `master`, `develop`) when none configured
- [ ] Add branch: free-text input, no existence validation
- [ ] Remove branch: `[×]` button disabled on last remaining entry
