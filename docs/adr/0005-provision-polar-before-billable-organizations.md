# Provision Polar before billable Organizations

Status: superseded by [ADR 0006](0006-separate-plan-from-subscription-status.md) and [ADR 0007](0007-organization-billing-customer-teams.md).

The former flow provisioned an individual customer using a separate billing email before organization creation. That model is no longer supported. The current model creates CustomerTeam only for checkout, keeps Hobby creation local and finalizes new Pro organizations only after payment. Operational instructions are maintained in [Polar billing](../polar-checkout.md).
