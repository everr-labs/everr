# Organization billing

Cloud billing maps each Everr organization to a Polar CustomerTeam. Hobby creation
makes no Polar calls. Checkout creates or recovers the team, and new Pro
organizations are finalized only after verified payment.

## Identity and access

The cloud-owned `organization_billing` table stores the plan and optional unique
Polar customer ID. These are server-managed billing data, not fields on the shared
Better Auth organization schema. `org_subscription` stores subscription state;
`pro_organization_checkout` persists creation attempts. See the
[billing schema](../src/db/schema/billing.ts) and
[database startup setup](../README.md#package-composition) for migration ownership.

A team's `externalId` must equal the organization ID. Checkout always uses an
explicit, verified customer ID. A Pro organization with a missing reference can
recover it by external ID; a Hobby organization without one starts through
checkout. A saved reference is verified rather than silently replaced.

Polar is authoritative for the billing owner, who must be an Everr organization
owner. The earliest owner membership selects the initial owner for an existing
organization; the creator is the initial owner for a new Pro organization.
Other owners and admins become billing managers. Everr links managed members by
`externalId = userId`, not email. Independent contacts have no external ID and
remain untouched. Email collisions fail explicitly instead of adopting contacts.

Any Everr owner can transfer billing ownership to another owner. The billing owner
cannot be removed, demoted, or delete their account before transferring that role.
Downgrade requires the actor to be the billing owner when one exists. Organizations
connected to billing cannot currently be deleted.

Portal access checks the actor's local role, reconciles members, and issues a
member-scoped session. Membership revocation reaches Polar before the local
removal or demotion commits. Profile synchronization uses the actual user being
updated, including signed-out email verification, and requires verified email.

## Checkout and recovery

New Pro checkout persists a reserved organization ID, creator, name, and slug
before contacting Polar. One incomplete attempt is allowed per creator and trimmed
name. The attempt deliberately has no organization or creator foreign key, so it
can precede organization creation and survive later creator deletion.

Retries reuse the customer and valid checkout sessions. Expired sessions can be
replaced using the same reserved organization ID. Paid upgrades resume completion
while their webhook is pending. Checkout, customer, organization, configured
product, and subscription identities must agree before granting Pro. Redirects
and webhooks share payment verification and finalization; older subscription
events cannot overwrite newer state. Only customer-bound version 2 creation
metadata is supported.

PostgreSQL advisory locks serialize billing mutations. Better Auth requests retain
locks through local writes and hooks; nested operations reuse the request's lock
connection. The lock pool is separate from application query connections.

There is no durable billing operation journal or periodic billing recovery worker.
If Polar succeeds and a local write fails, the systems can remain inconsistent
until a later membership operation, checkout, or portal access reconciles them.
That is a current limitation. Failed operations do not persistently block future
actions, but each retry must pass authorization and identity verification.
Resolve identity conflicts in the linked records or Polar contacts before retrying;
do not delete billing history to bypass validation.

## Code entry points

[The billing module](../src/billing/module.ts) exposes application operations.
[Server composition](../src/billing/server.ts) supplies the database, Polar gateway,
advisory locks, and application URL. Authentication supplies organization creation
during finalization through its adapter and hooks.

- `identity.ts` and `members.ts` own team identity, ownership, portal access, and member reconciliation.
- `checkout.ts` and `attempts.ts` own checkout initiation and persisted creation identity.
- `subscription.ts` and `verification.ts` own finalization, payment validation, and subscription events.
- `store.ts` owns persistence; `polar.server.ts` owns SDK calls and provider-error translation.

## Verification

Run `pnpm --filter @everr/app-cloud test` for local billing, auth integration,
routing, and UI coverage. Billing module tests use PGlite and a controlled Polar
gateway. Lock tests exercise the PostgreSQL connection contract.

Run `pnpm --filter @everr/app-cloud test:billing:sandbox` for the remote adapter
contract. It reads `packages/cloud/.env`, requires `POLAR_SERVER=sandbox`, and
creates and cleans up its own temporary teams. It checks shared personal email
across teams, customer-bound checkout, ownership transfer, email updates, and
revocation of an issued portal token. It does not make a payment; paid browser
checkout remains a separate acceptance check.
