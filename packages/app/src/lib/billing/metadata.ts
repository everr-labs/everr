import { z } from "zod";
export const creationMetadata = z.object({
  everrPurpose: z.literal("create_pro_organization"),
  everrSchemaVersion: z.literal(2),
  everrOrganizationId: z.string().min(1),
  everrOwnerId: z.string().min(1),
  everrOrganizationName: z.string().min(1),
  everrOrganizationSlug: z.string().min(1),
});
export type CreationMetadata = z.infer<typeof creationMetadata>;
