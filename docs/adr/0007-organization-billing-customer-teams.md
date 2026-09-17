# Organization billing uses Polar CustomerTeam

Status: accepted.

One Everr organization corresponds to one Polar CustomerTeam. Polar stores the team owner; Everr does not duplicate that role locally. Multiple Everr organization owners are permitted, and the Polar owner must be one of them. The Better Auth organization stores the optional unique `polarCustomerId` as a server-managed additional field. Billing verifies the customer external ID before linking or using it. External-ID lookup recovers missing references; there is no separate billing profile. The reserved new-Pro checkout attempt retains its customer ID until and after finalization for retry and payment verification. Other owners and admins are billing managers. Hobby creation and authentication never provision Polar resources; a team is created exclusively when starting the first checkout.

The billing module owns customer identity, managed member synchronization, checkout recovery and subscription finalization. External dependencies are injected; authentication supplies its organization-creation callback. Callers use application operations, not the SDK. The reserved organization ID is both the future Better Auth ID and the team's external ID. Checkout always receives an explicit, verified customer ID.

Everr governs members with `externalId = userId`, without a local mapping table. Member external IDs are reserved for Everr users; independent contacts have no external ID. Personal email is not an identity key. Independent Polar contacts remain independent; collisions require reconciliation. The designated billing owner cannot lose organization ownership or delete their account before a transfer. Only a current authorized member receives a member-scoped portal session.

Membership revocations precede local writes, and request-scoped PostgreSQL locks serialize changes. There is no durable operation journal, recovery worker or persistent block after a failed operation. Inconsistency after remote success and local failure is an accepted trade-off. Reconciliation runs during membership changes, checkout and portal access; no periodic scan is added. Polar remains authoritative for the current team owner.

Only customer-bound version 2 creation attempts are supported. Legacy individual, customerless and version 1 paths are removed. Existing local data uses verified team discovery and reads the owner from Polar; sandbox billing history is not deleted automatically. Apply the additive schema before the new code. See [the operational guide](../polar-checkout.md) for recovery and verification.
