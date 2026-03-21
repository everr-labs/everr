# Scopes

## State storage refactor — replace Session with Account

- [ ] Remove `Session` struct and all associated helpers from `AppStateStore` (`load_session`, `save_session`, `clear_session`, `has_active_session`, `load_session_for_api_base_url`, etc.)
- [ ] Add `Account` struct (`everr_account_id`, `everr_org_id`, `token`, `github_orgs`)
- [ ] Add `accounts: Vec<Account>` to `AppState`, removing `session`
- [ ] Add `AppStateStore` helpers: `add_account` (errors if `everr_org_id` already exists), `remove_account`, `accounts`, `update_account_orgs`
- [ ] Update all callers — login flow writes `Account` instead of `Session`; API client takes a token directly; CLI auth gateway replaced with account resolution; desktop app session checks replaced with accounts list
- [ ] Tests: round-trip, missing keys, old state with `session` field loads as default (wiped)

## `everr add-account` — CLI command to authenticate a new org

*Prerequisite: confirm the Everr API org fetch endpoint exists and its response shape before building the client side (see Rabbit Holes in pitch).*

- [ ] Implement `everr add-account` command: open browser to Everr login flow
- [ ] On callback: call Everr API to fetch `github_orgs` for the authenticated Everr org
- [ ] Append one `Account` entry to `AppState` via `add_account`
- [ ] Implement `everr remove-account` command: remove an account entry from `AppState` by Everr org
- [ ] Tests: stub Everr API with single-org and multi-org payloads; verify state written correctly

## Account resolution — auth layer above AppStateStore

- [ ] Implement auth layer: extract GitHub owner from `git remote get-url origin` (SSH + HTTPS)
- [ ] Local scan: find account where owner is in `github_orgs`
- [ ] On miss: call Everr API to refresh `github_orgs` for all accounts via `update_account_orgs`, retry
- [ ] On second miss: error with actionable message
- [ ] On API refresh failure: clear error distinguishing auth vs connectivity
- [ ] Tests: local hit, miss→refresh→found, miss→refresh→still not found, SSH URL, HTTPS URL, API refresh fails

## Desktop app: multi-account notifications

- [ ] Update notification poller to iterate all accounts in `AppState.accounts`
- [ ] Fetch notifications per account using its own token
- [ ] Merge results and display together in the UI
- [ ] Return per-account errors in poller result without aborting other accounts
- [ ] Tests: poller iterates all accounts; per-account error does not abort others

## Desktop app: account management

*Depends on: multi-account notifications above — per-account errors must be available before they can be surfaced here.*

- [ ] Add accounts settings view listing all entries in `AppState.accounts` by GitHub org names
- [ ] Add "Add account" button that triggers the Everr login flow (same as `everr add-account`)
- [ ] Add "Remove account" button per entry; calls `remove_account` via `AppStateStore`
- [ ] On add completion, write new `Account` to `AppState` via `AppStateStore`
- [ ] Surface per-account auth errors from the notification poller in the account list view

## Web app: org switcher

- [ ] Integrate WorkOS org list API to retrieve the available Everr orgs for the authenticated user
- [ ] Add org switcher UI element (top nav) rendering the WorkOS org list
- [ ] On org selection: call WorkOS to switch the active org session and reload the view
- [ ] Add org switcher to the CLI auth page (shown during `everr add-account` browser flow) so the user selects which org to authenticate into before completing the flow
