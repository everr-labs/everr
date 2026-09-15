import * as z from "zod";

export class BillingEmailUnavailableError extends Error {
  name = "BillingEmailUnavailableError";

  constructor() {
    super("This billing email cannot be used.");
  }
}

const OrganizationNameSchema = z
  .string()
  .trim()
  .min(2, "Organization name must be at least 2 characters")
  .max(100, "Organization name must be at most 100 characters");

export const BillingEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid billing email"));

export const CreateOrganizationInputSchema = z.object({
  organizationName: OrganizationNameSchema,
  billingEmail: BillingEmailSchema,
});

export const ProvisionOrganizationBillingInputSchema = z.object({
  billingEmail: BillingEmailSchema,
});
