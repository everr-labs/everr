# Provision Polar before billable Organizations

An explicitly created Organization is billable and must have a Polar Customer. Everr first verifies the Billing email and creates an unlinked Polar Customer, then creates the Organization through the server-owned Better Auth flow, and finally assigns the Organization ID as the Customer's external ID. This ordering prevents an Organization from being reported as created when Polar has rejected its Billing email.

## Consequences

- If Better Auth creation fails, Everr deletes and anonymizes the provisional Polar Customer so its Billing email becomes reusable. If linking fails, Everr reconciles by external ID before compensating both resources. If Polar compensation fails, Everr retains the Organization for recovery instead of deleting the only local reference to the Customer.
- Direct client access to Better Auth Organization creation is disabled so it cannot bypass Polar provisioning.
- The automatic Organization created for a User with no Memberships remains an explicit exception. Polar provisioning uses the User email in best effort and does not block access.
- An Owner or Admin can repair an Organization without a Polar Customer from Plan & Billing by providing a unique Billing email.
- Organization deletion remains blocked while a Polar Customer is linked, because deleting a Customer can cancel subscriptions and revoke benefits.
