# Separate Organization Plan from subscription status

Hobby Organizations may have no Polar Customer or an inactive subscription, while Pro Organizations require an active subscription with no trial. Loss of an active Pro subscription suspends the Organization rather than automatically converting it to Hobby: automatic conversion could violate both the individual membership limit and the Owner's limit of one Hobby Organization. A dedicated recovery page offers payment-method updates or an explicit downgrade process.

New Pro Organizations are finalized only after Polar confirms the checkout and the active subscription. This revises ADR 0005: provisioning a Customer and validating the unique Billing email alone is insufficient to finalize a Pro Organization. Explicit creation offers Hobby or Pro when the User owns no Hobby Organization, and only Pro otherwise; automatic initial creation remains Hobby and requires no Polar provisioning.

Customer identity, reserved checkout attempts and finalization follow [ADR 0007](0007-organization-billing-customer-teams.md). Both the authenticated callback and signed subscription webhook share payment verification and finalization. Checkout attempts persist a reserved organization ID before payment; Better Auth creates the organization with that exact ID after payment.

Polar owns price revisions and keeps each existing subscription on its agreed price. The application therefore does not version prices or commercial offers. Each deployment maps the Pro Plan to its current Polar Product identifier and may retain historical Product identifiers when a new Product becomes necessary. New checkouts use the current Product, while active subscriptions on configured historical Products continue to grant Pro. The raw Product identifier remains on the subscription for reconciliation. A webhook rejects unconfigured Products before persisting entitlement changes; entitlement reads raise the same error until the deployment catalog is corrected.

Existing Organizations are outside the migration and remediation scope of this change. Suspension enforcement in APIs, MCP, and ingestion is also outside scope; this iteration provides the application recovery experience.

The Organization stores `plan` directly. Organization ownership remains represented by Membership roles. The owner member of the Polar team identifies which organization owner is responsible for billing, without duplicating that role in Everr. The one-Hobby-per-Owner rule is an application-level constraint serialized with a PostgreSQL advisory lock; this trade-off is accepted at this stage of the project. Subscription lifecycle data remains separate because it represents the billing provider state rather than the Organization's commercial Plan.

## Recovery and downgrade

Owners and Admins can update the payment method; only an Owner can downgrade, and that Owner must first be the designated billing owner. Downgrade retains the Owner performing it and removes all other Members. It is blocked if that Owner already owns another Hobby Organization. Other Members see a suspension notice directing them to an administrator.

A scheduled cancellation preserves Pro while the subscription remains active. Any transition away from active, including past_due and unpaid, suspends Pro without an additional grace period.
