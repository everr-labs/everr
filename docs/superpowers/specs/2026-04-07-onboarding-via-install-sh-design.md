# Design: Full onboarding via install.sh

**Date:** 2026-04-07
**Idea:** `todo/ideas/onboarding-via-install.sh.md`

## Goal

Let new users complete the full Everr onboarding — account creation, org setup, GitHub App install, and runs import — without leaving the terminal after the initial browser sign-up.

## Scope

- `install.sh` already installs the CLI and calls `everr setup`. This work renames `everr setup` to `everr onboarding` and expands it.
- `npx everr init` is out of scope.
- GitHub App installation from the terminal is out of scope for `everr onboarding`; it is handled in the browser for new users and in `everr init` for existing users.

---

## Architecture

Four components change:

| Component | Location | Change |
|-----------|----------|--------|
| `/cli/device` page | `packages/app` (React) | Handles org auto-creation and GitHub App install for new users |
| 4 new REST routes | `packages/app` (TS) | Org info, org rename, repos list, import stream |
| `everr onboarding` | `packages/desktop-app/src-cli` (Rust) | Replaces `everr setup`; adds org rename and import steps |
| `everr init` | `packages/desktop-app/src-cli` (Rust) | New per-repo command: import + AGENTS.md |

---

## `/cli/device` page — extended for new users

The page already redirects unauthenticated users to WorkOS sign-up/sign-in. After that redirect resolves, the new logic is:

**When `auth.organizationId` is null:**
1. Call `workOS.userManagement.listOrganizationMemberships({ userId })`.
   - If the user has existing orgs → `switchToOrganization` to the first one (sorted by creation date, most recent first), proceed to code confirmation as normal. Multi-org selection is out of scope.
   - If the user has no orgs → auto-create an org with a placeholder name (e.g. "Guido's organization" using the user's first name from their WorkOS profile), add the user as admin, switch session to the new org.
2. After auto-creating org, show the GitHub App install UI (same button as the onboarding wizard's GitHub step).
3. After GitHub App is installed (or skipped), show the device code confirmation UI.
4. After confirmation, show "Return to your terminal to continue."

**When `auth.organizationId` is already set:**
- Confirm code as today. No change.

The device page gains two server calls: `listOrganizationMemberships` and `createOrganizationForCurrentUser` (already exists in `data/onboarding.ts`).

---

## New server endpoints

All four endpoints sit under `/api/cli/`, use `cliAuthMiddleware` (Bearer token auth), and follow the existing patterns in `packages/app/src/routes/api/cli/`.

### `GET /api/cli/org`

Returns the current user's org info.

```json
{
  "name": "Acme Inc.",
  "isOnlyAdmin": true
}
```

`isOnlyAdmin` is derived from `workOS.userManagement.listOrganizationMemberships({ organizationId, roleSlug: 'admin' })`. If the result contains only the current user, `isOnlyAdmin` is `true`.

### `PATCH /api/cli/org/name`

Renames the org.

```json
// request body
{ "name": "Acme Inc." }
```

Calls `workOS.organizations.updateOrganization({ organizationId, name })`. Returns `{ ok: true }`.

### `GET /api/cli/repos`

Lists repos available from the active GitHub App installation.

Returns the same shape as the existing `getInstallationRepos` server function (array of `{ id, fullName }`). Returns an empty array if no active installation exists.

### `POST /api/cli/import`

Triggers a backfill for a list of repos and streams progress as newline-delimited JSON (NDJSON).

```json
// request body
{ "repos": ["owner/repo-a", "owner/repo-b"] }
```

Each line in the response is one of:

```json
{ "type": "repo-start", "repoFullName": "owner/repo-a", "repoIndex": 0, "reposTotal": 2 }
{ "type": "progress", "progress": { "jobsEnqueued": 12, "jobsQuota": 50, "runsProcessed": 4 } }
{ "type": "repo-error", "repoFullName": "owner/repo-a" }
{ "type": "done", "totalJobs": 12, "totalErrors": 0 }
```

This reuses the `backfillRepo` generator from `server/github-events/backfill.ts`, same logic as `importRepos` in `data/onboarding.ts`.

---

## `everr onboarding` (renamed from `everr setup`)

Steps in order. Each step is skipped if its precondition isn't met.

| Step | Condition |
|------|-----------|
| 1. Authenticate | Always runs. Device flow: shows code + URL, polls until approved. |
| 2. Rename org | Only if `GET /api/cli/org` returns `isOnlyAdmin: true`. Pre-filled prompt; press enter to keep, or type a new name. Calls `PATCH /api/cli/org/name`. |
| 3. Import repos | Only if `GET /api/cli/repos` returns a non-empty list. Multiselect (up to 3 repos), calls `POST /api/cli/import`, renders NDJSON progress with a `cliclack` spinner. |
| 4. Notification emails | Same as today. |
| 5. AI assistants | Same as today. |
| 6. Desktop app | Same as today. |

`cli.rs`: rename the `Setup` variant to `Onboarding` with command name `"onboarding"`. Keep `"setup"` as a hidden alias for backwards compatibility.

---

## `everr init` (new command)

Configures the current repo. Run from within a git repository.

Steps:

1. **Check auth.** If no session, exit with: "Run `everr onboarding` first."
2. **Detect repo.** Read the git remote URL from the current working directory (reuse `everr_core::git`), derive `owner/repo` full name.
3. **Import** — only if:
   - GitHub App is installed (`GET /api/cli/repos` returns non-empty), **and**
   - Repo has no existing runs (`GET /api/cli/runs?repo=owner/repo&limit=1` returns empty).
   If both conditions are met, call `POST /api/cli/import` with this single repo and stream progress.
   If GitHub App is not installed, print a note: "No GitHub App detected. Install it from https://everr.dev and re-run `everr init` to import runs."
4. **Write repo assistant instructions** — detect which files exist in `cwd` and write to all that apply:
   - `AGENTS.md` present → write/update it
   - `CLAUDE.md` present → write/update it
   - Both present → write/update both
   - Neither present → create `AGENTS.md`
   
   A new `init_repo_instructions_auto(cwd, command_name)` function in `everr_core::assistant` will replace the current `init_repo_instructions` (which always writes only `AGENTS.md`). Uses the existing `write_generic_managed_block` for idempotency.

`cli.rs`: add `Init` variant with command name `"init"`.

---

## ApiClient additions (`crates/everr-core/src/api.rs`)

Four new methods on `ApiClient`:

```rust
pub async fn get_org(&self) -> Result<OrgResponse>
pub async fn patch_org_name(&self, name: &str) -> Result<()>
pub async fn get_repos(&self) -> Result<Vec<RepoEntry>>
pub async fn import_repos(&self, repos: &[String]) -> Result<impl Stream<Item = Result<ImportEvent>>>
```

`import_repos` uses `reqwest` streaming + line-by-line NDJSON parsing, similar to the existing `events_stream` method.

New response types:

```rust
pub struct OrgResponse { pub name: String, pub is_only_admin: bool }
pub struct RepoEntry { pub id: i64, pub full_name: String }
pub enum ImportEvent {
    RepoStart { repo_full_name: String, repo_index: u32, repos_total: u32 },
    Progress { jobs_enqueued: u32, jobs_quota: u32, runs_processed: u32 },
    RepoError { repo_full_name: String },
    Done { total_jobs: u32, total_errors: u32 },
}
```

---

## Data flow summary

```
curl | sh
  └─ installs binary
  └─ runs: everr onboarding
        ├─ step 1: device flow
        │     └─ browser: /cli/device
        │           ├─ new user: sign up (WorkOS) → auto-create org → GitHub App install → confirm code
        │           └─ existing user: confirm code
        ├─ step 2: rename org (if only admin)
        ├─ step 3: import repos (if GitHub App installed)
        ├─ step 4: notification emails
        ├─ step 5: AI assistants
        └─ step 6: desktop app

cd my-repo && everr init
  ├─ check auth
  ├─ detect repo (git remote)
  ├─ import if: GitHub App installed AND no existing runs
  └─ write AGENTS.md
```

---

## Out of scope

- `npx everr init`
- Terminal-native GitHub App installation in `everr onboarding`
- Multi-org switching from the terminal
