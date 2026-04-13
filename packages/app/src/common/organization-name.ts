import * as z from "zod";

export const OrganizationNameSchema = z
  .string()
  .trim()
  .min(2, "Organization name must be at least 2 characters")
  .max(100, "Organization name must be at most 100 characters");

export const CreateOrganizationInputSchema = z.object({
  organizationName: OrganizationNameSchema,
});

export type CreateOrganizationInput = z.infer<
  typeof CreateOrganizationInputSchema
>;
