# Organization billing with Polar CustomerTeam

The Better Auth organization stores an optional, unique `polarCustomerId`. The extension exposes this reference in responses and client types but rejects client writes (`input: false`). Billing verifies the team external ID before persisting or using the reference. Organizations without a reference recover an existing team through `externalId = orgId`; no separate customer-link table is needed. Polar is the source of truth for its team owner, who must remain an Everr owner; other owners and admins are billing managers. Hobby creation makes no Polar calls. The first checkout creates a Polar CustomerTeam with `externalId = orgId`, the organization name and the initial owner's personal identity. All checkouts use the verified `customerId`. There is no billing email form, individual customer conversion or email-based customer selection.

A person can own several teams with the same personal email. Within a team, Everr links its users to Polar members by `externalId = userId`, without a local member-mapping table. Member external IDs are reserved for Everr identities; independent contacts have no external ID. Email is a mutable contact field. An email collision with an independent contact fails explicitly rather than adopting that contact. Independent contacts, fiscal details, payment methods and history remain in Polar.

## Module boundaries

`packages/app/src/lib/billing/module.ts` is the application interface. `server.ts` composes the database, Polar gateway, advisory locks and infrastructure provisioning. Better Auth supplies the organization-creation callback; the billing domain never imports `auth.server.ts`.

- `identity.ts` owns team identity, reads and transfers the Polar owner, authorizes portal access and reconciles members during billing actions.
- `members.ts` reconciles managed identities and revokes obsolete grants.
- `checkout.ts` starts and resumes customer-bound sessions; `attempts.ts` handles reserved creation identity.
- `subscription.ts` finalizes organizations and handles subscription events. `verification.ts` shares payment and identity checks with the redirect and checkout retry paths.
- `store.ts` owns shared persistence operations and stale-event protection. `polar.server.ts` contains the SDK, pagination, email PATCH endpoint and safe provider-error translation.
- Auth adapters and plugins connect actual Better Auth mutations to the module.

## Owner and member changes

Before the first checkout there is no billing owner to persist. For an existing organization the earliest current owner membership selects the initial team owner; an admin may start checkout. For a new Pro organization, the creator is the initial owner. Afterwards Polar alone stores the owner role, including transfers performed directly in its portal. Any Everr owner can transfer billing ownership to another Everr owner from Billing. Admins can see the responsible person but cannot transfer the role. The billing owner cannot be removed, demoted or delete their account until the responsibility is transferred. Downgrade requires the retained owner to be the billing owner.

Role changes, removal, voluntary leave, accepted invitations and direct additions reconcile linked members. Profile writes use the actual database target, including anonymous email verification callbacks. Email synchronization uses only the definitive verified email. Revocation reaches Polar before local membership removal or demotion is committed. Removing a Polar member invalidates that member's existing portal token, as verified in sandbox.

Opening the portal verifies the current actor's local role, reconciles linked members, then creates a session scoped to that member. A missing customer returns a recoverable result without provisioning. Reconciliation makes Everr's committed membership and identity authoritative for linked members; it never removes independent contacts.

## Durability and recovery

Each organization mutation is serialized by a PostgreSQL advisory lock. Better Auth requests retain their locks through local writes and hooks. Nested operations reuse the request's connection. The separate lock pool preserves the `pg` password property and does not consume application query connections.

There is no durable operation journal or billing recovery worker. If Polar succeeds and a local write fails, the two systems may remain inconsistent until a later membership operation, checkout or portal access reconciles them. This risk is accepted. Failed operations do not leave a persistent block on checkout or portal access; those actions still require their own authorization and reconciliation to succeed. Locks and revocation-before-local-write ordering remain in place. No periodic scan replaces the removed worker.

New Pro creation persists a reserved ID and owner/name/slug before contacting Polar, then records its customer and checkout. A partial unique index permits one incomplete attempt per owner and trimmed name. Completed attempts do not prevent later organizations using the same name. New Pro organizations are created only after payment through Better Auth's reserved-ID context, preserving membership and infrastructure hooks.

Retries list sessions for the known customer and validate their metadata. Open sessions are reused, confirmed or paid sessions return to completion, and expired sessions are replaced with the same reserved org ID. Uncertain creation responses are reconciled before another creation. Paid upgrades are resumed while their webhook is pending. Checkout, customer, organization, product and subscription identity must agree. Webhook and redirect share finalization; duplicate delivery and partial provisioning failures are recoverable. Older subscription events cannot overwrite newer state.

## Schema and local cutover

Apply `packages/app/drizzle/0013_organization_customer_teams.sql` through the normal Drizzle migration workflow before deploying the new application. This final migration was generated after explicit approval at the end of schema iteration. It adds:

- `organization.polar_customer_id`: nullable unique customer reference, declared as a server-managed Better Auth additional field.

- `pro_organization_checkout.polar_customer_id`, alongside the existing reservation and incomplete owner/name unique index.

The checkout schema changes were applied and inspected in the local PostgreSQL database during implementation. The final migration was not applied to that local database because those changes already exist there. Other environments must apply and verify the migration before deployment. Back up local data before applying schema changes through the repository's normal Drizzle workflow.

Existing organizations can reuse a team found by organization external ID. Discovery verifies and stores the customer ID on the organization, without creating a customer outside checkout. Once saved, subsequent operations fetch that exact customer and reject identity mismatches instead of silently relinking. A new Pro attempt retains the ID before the organization exists, then finalization copies the verified reference onto the organization. The owner is read from that team's owner member and must map to a current Everr owner. Individual customers or inconsistent identities fail explicitly. Do not delete sandbox payments, subscriptions or customers to resolve a conflict. Unrelated sandbox records are preserved.

The earlier refactor introduced `organization_billing`, `billing_member` and `billing_operation`. All three have been removed from the schema and local database. They contained no local rows at removal. These temporary-table removals were local schema iteration, not migration files; no Polar resources were changed. Environments that applied the earlier refactor can remove these tables after stopping the old billing reconciliation worker.

Only creation metadata version 2 with a persisted customer-bound attempt is supported. Version 1, customerless checkouts and mismatched identities fail without granting Pro. Previously issued unsupported checkout URLs may remain payable in Polar until they expire; they must not be used after cutover. There is no legacy-data conversion or compatibility finalizer.

## Verification and observability

Run the app typecheck, Biome, Fallow dead-code/cycle checks, and tests under `src/lib/billing`, the billing and organization data tests, billing UI tests, account-settings tests and worker runtime tests. The module suite uses PGlite persistence and a controllable Polar gateway. Real Better Auth tests cover the reserved ID, hooks, blocked membership changes and anonymous verified-email updates. PostgreSQL tests preserve the real lock-pool contract.

`pnpm --filter @everr/app test:billing:sandbox` requires the app `.env` to select Polar sandbox. It creates and removes only its own temporary team fixtures. It verifies shared personal email across teams, explicit customer checkout, ownership transfer, email PATCH and rejection of an already-issued portal token after member deletion. It does not make a payment. The token requires customer, member, checkout, subscription and customer-session permissions.

Telemetry emits `billing.reconciliation.completed` and `billing.provider.failed`. Organization and provider-operation context uses `everr.*`; provider status uses `http.response.status_code` and failures use `error.type`. Technical causes remain attached to application errors; provider response bodies, tokens and personal email are not included in billing log attributes.

Manual authenticated app testing requires `.auth` in the main worktree. It was unavailable during this refactor. Paid end-to-end browser flows therefore remain a manual acceptance check; automated tests simulate their payment events and sandbox tests validate the remote adapter contracts.
