# Onboarding Experience Improvement Plan

## Goals
1. Add organization name setup as an explicit onboarding step.
2. Make GitHub App installation an explicit step in onboarding.
3. Add CLI onboarding step using a short-lived invite token flow.
4. Remove MCP server access from onboarding and centralize token management in Account Settings.

## Product Requirements
- Onboarding includes a required organization name step.
- Onboarding includes a GitHub App installation step that can be skipped.
- Onboarding includes a CLI step where an install script generates a 30-minute invite token.
- CLI exchanges invite token for a durable auth token.
- Every onboarding step except organization name is skippable.
- MCP server onboarding is removed for now.
- Token generation and token list management move to Account Settings.

## Scope
- Web app onboarding flow (UI + backend endpoints used by onboarding).
- CLI authentication bootstrap flow.
- Token model and token management UI in Account Settings.
- MCP server onboarding removal (UI, docs, and backend hooks tied only to onboarding).

## Non-Goals
- Reintroducing MCP server setup in onboarding.
- Redesigning unrelated onboarding steps.
- Changing durable auth token semantics outside the invite-token bootstrap.

## Proposed End-State Flow
1. User signs in and lands in onboarding.
2. Step 1: Set organization name.
- UI validates organization name format/availability and blocks next step until valid.
3. Step 2: Install GitHub App.
- UI checks installation status and offers `Skip for now`.
4. Step 3: Connect CLI.
- User runs install script.
- Script calls backend to create invite token (TTL 30 minutes).
- User pastes invite token into CLI (or script passes it directly).
- CLI exchanges invite token for auth token and stores it securely.
- UI offers `Skip for now`.
5. Onboarding complete.
6. In Account Settings, user can generate/list/revoke tokens.

## ASCII Diagram
```text
+------------------+
| User signs in    |
| Enters onboarding|
+--------+---------+
         |
         v
+---------------------------+
| Step 1: Set Org Name      |
| (required to continue)    |
+--------+------------------+
         |
    name valid?
    /      \
   no       yes
   |         |
   |         v
   |   +---------------------------+
   |   | Step 2: Install GitHub App|
   |   | (optional, skippable)     |
   |   +--------+------------------+
   |            |
   |   install now or skip
   |       /        \
   |    install      skip
   |      |           |
   |      v           v
   |   +------------------------------+
   |   | Step 3: Connect CLI          |
   |   | Run install script (optional)|
   |   | or Skip for now              |
   |   +---------------+--------------+
   |                   |
   |                   v
   |   +------------------------------+
   |   | Backend creates invite token |
   |   | TTL: 30 minutes, single-use  |
   |   +---------------+--------------+
   |                   |
   |                   v
   |   +------------------------------+
   |   | CLI sends invite token       |
   |   | to exchange endpoint         |
   |   +---------------+--------------+
   |                   |
   |          token valid + unused?
   |             /            \
   |            no             yes
   |            |               |
   |            v               v
   |   +----------------+   +--------------------------+
   |   | Error: expired |   | CLI receives auth token  |
   |   | used/revoked   |   | and stores it securely   |
   |   +-------+--------+   +------------+-------------+
   |           |                         |
   |           v                         v
   |   +----------------------+   +----------------------+
   |   | Regenerate token in  |   | Onboarding completed |
   |   | Account Settings     |   +----------------------+
   |   +----------------------+
   |
   +--> stay on Step 1 until org name is valid

After onboarding:
+----------------------------------------------+
| Account Settings > Tokens                    |
| - Generate invite token                      |
| - List tokens (active/expired/used/revoked) |
| - Revoke token                               |
+----------------------------------------------+
```

## Architecture Changes

### 1) Organization Name as Required Onboarding Step
- Add explicit onboarding step state machine entry: `organization_name`.
- Add org-name validation endpoint/rules consumed by onboarding UI.
- Enforce progression guard until org name is valid and persisted.
- Ensure org name is available as tenant/org display metadata for subsequent steps.

### 2) GitHub App as Optional Onboarding Step
- Add explicit onboarding step state machine entry: `github_app_install`.
- Add backend status endpoint consumed by onboarding UI:
  - returns `installed`, `installation_id`, `installed_at`, `org/repo scope` summary.
- Add polling/revalidation logic after installation redirect.
- Add `Skip for now` path that allows progression without installation.
- Mark tenant onboarding state as `github_app_pending` when skipped.

### 3) Invite Token Bootstrap for CLI
- Add invite token entity (or token type) with fields:
  - `id`
  - `tenant_id`
  - `created_by`
  - `expires_at` (exactly now + 30 minutes)
  - `used_at` (nullable, single-use)
  - `revoked_at` (nullable)
  - `metadata` (optional: source=`install_script`)
- Add endpoint: create invite token (authenticated user context).
- Add endpoint: exchange invite token for CLI auth token.
- Enforce server-side constraints:
  - single-use
  - strict 30-minute expiry
  - tenant binding
  - audit trail for create/exchange/revoke events
- Update install script to request invite token and print or forward it to CLI.
- Update CLI login command to accept invite token and perform exchange.
- Keep CLI onboarding step skippable; users can complete it later from Settings or docs.

### 4) Move Token Management to Account Settings
- Add Account Settings section: `Tokens`.
- Capabilities:
  - generate invite tokens
  - list active/expired/used/revoked invite tokens
  - revoke tokens
  - show creation/use timestamps and actor
- Remove token generation/list UI from onboarding.

### 5) Remove MCP Server from Onboarding
- Remove MCP step from onboarding sequence and completion criteria.
- Remove onboarding UI copy, CTA buttons, and backend checks related to MCP setup.
- Keep MCP implementation behind feature flag or dormant paths only if needed for future reintroduction.

## Implementation Plan

### Phase 1: Domain & API Foundations
- Introduce invite token schema + migration.
- Implement create/exchange/revoke/list invite-token endpoints.
- Add validation and audit logging.
- Add tests for token lifecycle edge cases:
  - expired token
  - reused token
  - revoked token
  - wrong tenant
  - concurrent exchange attempts

### Phase 2: CLI + Install Script Integration
- Update install script to create 30-minute invite token.
- Update CLI auth flow to exchange invite token for durable auth token.
- Store auth token in existing secure storage path.
- Add CLI integration tests for happy path and failure cases.

### Phase 3: Onboarding Flow Update
- Add required org-name step with server-backed validation.
- Add optional GitHub App step with status checks and explicit skip action.
- Add optional CLI step instructions tied to invite-token flow and explicit skip action.
- Remove MCP step and associated progression logic.
- Add frontend state and e2e tests for required-vs-optional step behavior.

### Phase 4: Account Settings Token Management
- Add Tokens page/section in Account Settings.
- Move token generation/list/revocation actions here.
- Link onboarding CLI step to Account Settings as fallback management location.

### Phase 5: Cleanup, Docs, and Rollout
- Remove deprecated onboarding code paths and copy.
- Update docs (onboarding, CLI auth, account settings tokens).
- Roll out behind feature flag, then progressively enable.
- Monitor auth failures, invite-token exchange rate, onboarding completion rate.

## Data Model & Security Considerations
- Store only hashed token values at rest; never persist raw token after creation response.
- Use high-entropy token format and constant-time comparison for lookup/verification.
- Enforce exact 30-minute TTL server-side regardless of client clock.
- Single-use exchange must be atomic (transaction + unique constraint/row lock).
- Audit events must include actor, tenant, IP/user-agent (if available), and timestamp.

## Migration & Backward Compatibility
- Existing CLI auth tokens remain valid.
- New invite-token flow applies to new onboarding and token generation paths.
- Remove MCP onboarding dependencies without breaking existing MCP users outside onboarding.

## QA Strategy
- Unit tests for token creation/exchange/revocation and expiry behavior.
- API tests for authz/authn and tenant isolation.
- CLI integration tests for token exchange and storage.
- E2E onboarding tests:
  - blocked before org name is set
  - successful org name step -> GitHub App step
  - skip GitHub App step -> CLI step
  - successful GitHub App install -> CLI step
  - skip CLI step -> onboarding completes
  - successful invite-token exchange completes onboarding
  - MCP step absent
- Account Settings UI tests for token list, generation, revocation.

## Rollout Metrics
- Onboarding completion rate.
- Drop-off rate per step (Org Name, GitHub App, CLI).
- Invite token create-to-exchange conversion rate.
- Invite token exchange failures by reason (expired, used, invalid).
- Time to first successful CLI authentication.

## Risks & Mitigations
- Risk: users hit expired invite tokens.
- Mitigation: clear countdown/expiry UX and one-click regenerate.

- Risk: race conditions in token exchange.
- Mitigation: atomic consume operation + concurrency tests.

- Risk: users skip GitHub App/CLI and delay activation.
- Mitigation: show post-onboarding reminders and clear CTAs in Account Settings.

## Acceptance Criteria
- Organization name is required and technically enforced during onboarding.
- GitHub App and CLI steps are skippable with explicit `Skip for now` actions.
- CLI onboarding uses invite token flow with hard 30-minute expiry and single-use exchange.
- MCP onboarding step is fully removed.
- Token generation/list/revoke is available in Account Settings.
- End-to-end tests cover happy path and key failure paths.
