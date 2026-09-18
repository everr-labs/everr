import * as z from "zod";

export const CreateOrganizationInputSchema = z.object({
  plan: z.enum(["hobby", "pro"]),
  organizationName: z
    .string()
    .trim()
    .min(2, "Organization name must be at least 2 characters")
    .max(100, "Organization name must be at most 100 characters"),
});
