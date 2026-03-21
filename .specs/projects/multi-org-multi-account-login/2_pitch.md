# Pitch: Multi-Account Login with Automatic Repo-to-Account Resolution

## Problem

Users with a personal and a work Everr account live under one global session. Switching between repos that belong to different accounts requires logging out and back in — enough friction that users stop switching and lose CI visibility for one of their accounts entirely.

## Solution

Allow multiple Everr accounts to be stored in state storage. Each account's associated GitHub orgs are fetched from the Everr API after login and cached locally. That association is used to automatically resolve the correct Everr account from the repo's git remote — no manual linking, no aliases.

### Adding an account

One new command:

```
everr add-account
```

Opens the browser to the normal Everr login flow. The user authenticates into one Everr org. On completion, Everr fetches the GitHub orgs for that Everr org from the Everr API and appends one `Account` entry to `AppState` via `AppStateStore`. To add a second org, the user runs `everr add-account` again (or uses the desktop app flow). Each invocation adds exactly one entry.

### State storage

`AppState` in `crates/everr-core/src/state.rs` is restructured — `session` is removed and replaced by `accounts`, alongside the existing `settings`:

Each entry in `accounts` represents one Everr org — one token per Everr org. A user with multiple Everr orgs has multiple entries. `github_orgs` maps the GitHub orgs that belong to that Everr org, cached locally from the Everr API.

```rust
pub struct Account {
    pub everr_account_id: String,  // the user's Everr account identity
    pub everr_org_id: String,       // the Everr org context for this token
    pub token: String,
    pub github_orgs: Vec<String>,  // GitHub orgs belonging to this Everr org — cached from Everr API
}

pub struct AppState {
    pub settings: AppSettings,  // existing — unchanged
    pub accounts: Vec<Account>, // replaces session; one entry per Everr org
}
```

`Session` and its associated helpers (`load_session`, `save_session`, `clear_session`, etc.) are removed from `AppStateStore`. New helpers added: `add_account`, `remove_account`, `accounts`, and `update_account_orgs`. All reads and writes go through the existing `load_state` / `save_state` / `update_state` pattern.

### Active account resolution (breadboard)

Resolution lives in an auth layer above `AppStateStore` (not inside it — `AppStateStore` is storage only):

1. Extract the GitHub org/owner from the repo's remote URL (`git remote get-url origin` → parse `github.com/{owner}/{repo}`)
2. Load accounts from `AppStateStore`; scan for an account where `owner` is in `github_orgs`
3. If found → use that account's token
4. If not found → call the Everr API (using each stored account's token) to refresh `github_orgs` for all accounts; persist the updated orgs via `update_account_orgs`; retry step 2
5. If still not found → error: _"No Everr account found for GitHub org '{owner}'. Run `everr add-account` to add one."_

The local scan (steps 1–3) is fast. The API refresh (step 4) only happens on a miss, so it doesn't add latency to the common case.

### Web app

The web app gains an Everr org switcher — a UI element (e.g. in the top nav) that lets the user change the active Everr org context. Switching orgs changes the active session and reloads the view for that org. The org switcher is powered by WorkOS APIs, which manage the available orgs for the authenticated user.

The org switcher is also present on the CLI auth page (the browser page shown during `everr add-account`) so the user can select which Everr org they're authenticating into before completing the flow.

### Desktop app

Uses the same state storage. Three desktop-specific additions:

**Account list**: a settings view showing all logged-in accounts. Each account is displayed by its GitHub org names (from `github_orgs`) — not the opaque account ID. Accounts can be removed from this view.

**Add account**: a button in the accounts settings view that triggers the same Everr login flow as `everr add-account` in the CLI. On completion, the new account is written to `AppState` via `AppStateStore`.

**Notifications**: the notification poller runs for all accounts in `AppState.accounts`, not just one. Each account's token is used independently to fetch its notifications. Results are merged and displayed together in the UI. If a fetch fails for an account (e.g. expired token), the poller returns the error as part of its result — it does not notify or alert. The account list view is responsible for surfacing per-account auth errors visibly in the UI.

## Rabbit Holes

- **Remote URL parsing**: GitHub remotes can be SSH (`git@github.com:org/repo.git`) or HTTPS (`https://github.com/org/repo.git`) — both must be handled. Forks may add a second remote; always use `origin`. Don't handle non-GitHub remotes this cycle.
- **State storage migration**: no backward compatibility needed — existing state is wiped on upgrade. Users re-authenticate with `everr add-account`.
- **Stale org list**: if a user's GitHub App installation changes (org added or removed), the local `github_orgs` cache is out of date. This is handled automatically — a miss on the local lookup triggers an API refresh before erroring. The edge case to watch: if the refresh API call itself fails (network down, token expired), the error message must be clear about whether it's an auth problem or a connectivity problem.
- **Multiple orgs per account**: the Everr API may return multiple orgs for a single account — the account entry must store all of them, not just the first.
- **Everr API org fetch**: `add-account` must call the Everr API post-login to retrieve the GitHub orgs for the new account. If this endpoint doesn't exist yet or returns a different shape than expected, the feature is blocked. Confirm the API contract before building the client side.

## No-gos

- **Manual repo linking**: no `everr link` command. Resolution is always automatic from the git remote.
- **User-defined aliases**: no custom labels for accounts. Display names come from the GitHub org and Everr org identifiers, not user input.
- **Global account switcher**: no `everr switch-account`. Context is always inferred from the repo.
- **Silent fallback to another account**: no account matched means an error, not a guess.
- **Non-GitHub remotes**: GitLab, Bitbucket, self-hosted — out of scope.
- **Syncing state across machines**: each machine manages its own state storage.

## Testing Strategy

State storage tests in Rust using `tempfile` (same pattern as existing `state.rs` tests) — no Postgres, no Vitest.

- State storage read/write: add account, read it back, handle missing keys, verify old state with `session` field loads as default (wiped).
- Active account resolution: table-driven tests — matched org (local hit), unmatched org (triggers API refresh → found), unmatched org (API refresh → still not found → error), empty accounts, SSH remote URL, HTTPS remote URL, multiple accounts with non-overlapping orgs, API refresh fails (network error → clear error message).
- `everr add-account` end-to-end: stub the Everr API org response with single-org and multi-org payloads; verify the correct `Account` entries are written to state.
- Desktop app: smoke test that the notification poller iterates all accounts and that per-account errors are returned in the result without aborting the others.
