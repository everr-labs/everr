import * as z from "zod";
import { returnToSchema } from "@everr/app/common/return-to";

export const CreateOrganizationInputSchema = z.object({
  plan: z.enum(["hobby", "pro"]).optional(),
  returnTo: returnToSchema.optional(),
  organizationName: z
    .string()
    .trim()
    .min(2, "Organization name must be at least 2 characters")
    .max(100, "Organization name must be at most 100 characters"),
});

export function deriveOrgName(name: string, email: string): string {
  const firstName = name?.split(" ")[0]?.trim() || email.split("@")[0];
  return `${firstName}'s projects`;
}

export function generateOrgSlug(): string {
  return `org-${crypto.randomUUID()}`;
}
