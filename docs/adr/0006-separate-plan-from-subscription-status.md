# Separate Organization Plan from subscription status

Hobby Organizations may have no Polar Customer or an inactive subscription, while Pro Organizations require an active subscription with no trial. Loss of an active Pro subscription suspends the Organization rather than automatically converting it to Hobby: automatic conversion could violate both the individual membership limit and the Owner's limit of one Hobby Organization. A dedicated recovery page offers payment-method updates or an explicit downgrade process.

New Pro Organizations are finalized only after Polar confirms the checkout and the active subscription. This revises ADR 0005: provisioning a Customer and validating the unique Billing email alone is insufficient to finalize a Pro Organization. Explicit creation offers Hobby or Pro when the User owns no Hobby Organization, and only Pro otherwise; automatic initial creation remains Hobby and requires no Polar provisioning.

The pending Organization name, generated slug, Owner identifier, purpose, and schema version travel as Polar checkout metadata. Both the authenticated success callback and the signed subscription webhook validate that metadata and invoke the same finalizer. The finalizer uses the generated unique Organization slug as its idempotency key, so concurrent or retried delivery reuses the Organization and subscription link. No local checkout-intent record is persisted.

Polar owns price revisions and keeps each existing subscription on its agreed price. The application therefore does not version prices or commercial offers. Each deployment maps the Pro Plan to its current Polar Product identifier and may retain historical Product identifiers when a new Product becomes necessary. New checkouts use the current Product, while active subscriptions on configured historical Products continue to grant Pro. The raw Product identifier remains on the subscription for reconciliation. A webhook persists the provider state and then raises a critical application error if its Product is not configured; entitlement reads raise the same error until the deployment catalog is corrected.

Existing Organizations are outside the migration and remediation scope of this change. Suspension enforcement in APIs, MCP, and ingestion is also outside scope; this iteration provides the application recovery experience.

The Organization stores `plan` directly. Ownership remains represented by the Membership role, avoiding a second source of truth that could diverge when roles change. The one-Hobby-per-Owner rule is an application-level constraint serialized with a PostgreSQL advisory lock; this trade-off is accepted at this stage of the project. Subscription lifecycle data remains separate because it represents the billing provider state rather than the Organization's commercial Plan.

## Recovery and downgrade

Owners and Admins can update the payment method; only an Owner can downgrade. Downgrade retains the Owner performing it and removes all other Members. It is blocked if that Owner already owns another Hobby Organization. Other Members see a suspension notice directing them to an administrator.

A scheduled cancellation preserves Pro while the subscription remains active. Any transition away from active, including past_due and unpaid, suspends Pro without an additional grace period.
