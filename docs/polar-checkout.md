# Polar checkout and organization creation

Everr collects only the organization name and plan. Hobby creation makes no Polar calls. At the first checkout, Everr creates a Polar team customer with `externalId = orgId`, the organization name, and an owner member using the organization owner's user ID, name, and personal email. The customer itself has no email. All new checkouts specify the resulting `customerId`; new Pro checkouts also retain the reserved external ID for recovery and compatibility.

Existing customers retain their Polar ID, external ID, billing details, and subscription history. At checkout or portal access, individual customers are converted to teams and their owner member is reconciled with the current Everr organization owner. Legacy owner members whose external ID defaults to the organization ID are reused only when their email matches. Multiple Everr owners are rejected because Polar supports exactly one owner.

Customer creation is reconciled by external ID after an uncertain response or concurrent creation. It never searches by email. The organization owner's identity comes from membership records, even when a different administrator starts checkout. No additional billing email input is required.

Team portal sessions include the authorized user's member ID. Organization administrators become billing managers when they open the portal. Missing customers produce a recoverable error without provisioning. Existing member email changes that cannot be updated through the installed SDK fail explicitly and require reconciliation. This change reconciles ownership on billing actions; it does not add background synchronization of membership removals or revoke existing Polar sessions. Deployment must account for that when managing billing permissions.

The Polar token needs customer read/write, member read/write, checkout, and customer session permissions.

## Database prerequisite

Apply the Drizzle schema addition for `pro_organization_checkout` before deploying this flow. No migration is generated in this change, following the repository's schema iteration policy. The table reserves an organization ID before payment and retains completed requests for idempotent callbacks. Its partial unique index permits one incomplete request per owner and trimmed organization name. It intentionally has no foreign key to the future organization.

Version 1 checkout metadata remains supported for sessions created before deployment. Version 2 sessions store the reserved organization ID. Rollbacks must retain version 2 webhook/finalization support while those sessions and subscriptions exist.

## Recovery

Reopening the same name resumes the owner's incomplete request. A known live session is fetched directly. An expired session or a lost create response is reconciled by paging Polar checkouts and comparing their own external customer IDs before creating a replacement. Do not use the checkout list's `externalCustomerId` filter for this recovery: Polar implements it through the customer table, which excludes unpaid checkouts without a customer. See [Polar checkout implementation](https://github.com/polarsource/polar/blob/main/server/polar/checkout/service.py).

A session advisory lock serializes submission and finalization for the owner and name. Lock connections use a separate pool capped at two connections per process, so their work cannot exhaust the application pool. Contention returns a retryable error instead of consuming all pool connections with waiting requests. A failed database write after a successful Polar request leaves the reservation available for reconciliation. Webhooks and the success page use the same finalizer. Existing organization membership and subscription state are recovered after partial failures; completed requests never recreate deleted organizations.

## Email already used by another customer

Owner emails are scoped to team members, so one person can own separate organization customers with the same email. Checkout receives an existing customer ID, preventing email-based selection of a different customer. Finalization still verifies customer, organization, product, and subscription identity.

Previously issued customerless checkout URLs are not resumed by the new flow; a new session is bound to the team customer. Old URLs can remain payable until they expire. Already confirmed or succeeded sessions still use the existing compatibility finalizer, including its billing-conflict guard. Do not repeat purchases for previously paid conflicting sessions: those payments still require reconciliation.

## Verification

Run the billing, organization creation, checkout recovery/finalization, and Better Auth ID-context tests plus the app typecheck. Exercise creation, cancellation/resumption, upgrade, existing customer portal, duplicate webhooks, and cross-organization email reuse in Polar sandbox. Manual authenticated app testing requires the main worktree's `.auth` credentials.

## Validation performed

Automated tests cover team provisioning, owner selection, shared owner emails, recovery after uncertain creation, existing customer conversion, member-scoped portal access, durable Pro checkout recovery/finalization, legacy compatibility, and the real Better Auth reserved-ID hook.

A real Polar sandbox API check created two team customers with the same existing user's email on their owner members and no customer email. Both accepted a fixed-price Pro checkout with explicit customer ID and a member-scoped portal session. Both temporary customers were deleted after validation. No payment was submitted, so paid invoices, notification delivery, and the complete payment lifecycle remain acceptance checks. Authenticated manual app testing was skipped because `.auth` is absent from the main worktree.

The local database now has the checkout-intent table and index applied. A live regression check exercised `startProOrganizationCheckout` with the real PostgreSQL advisory-lock pool and Polar sandbox, verified a team-bound checkout, and resumed the same checkout on retry. The temporary customer and intent were removed afterward. The lock pool explicitly preserves the non-enumerable `pg` password option when copying connection settings.
