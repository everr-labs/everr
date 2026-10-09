import * as z from "zod";
import { returnToSchema } from "./return-to";

export const CreateOrganizationInputSchema = z.object({
  plan: z.enum(["hobby", "pro"]),
  returnTo: returnToSchema.optional(),
  organizationName: z
    .string()
    .trim()
    .min(2, "Organization name must be at least 2 characters")
    .max(100, "Organization name must be at most 100 characters"),
});
