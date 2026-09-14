import * as z from "zod";

export const ProOrganizationCheckoutMetadataSchema = z.object({
  everrPurpose: z.literal("create_pro_organization"),
  everrOwnerId: z.string().min(1),
  everrOrganizationName: z.string().min(1),
  everrOrganizationSlug: z.string().min(1),
  everrSchemaVersion: z.literal(1),
});

export type ProOrganizationCheckoutMetadata = z.infer<
  typeof ProOrganizationCheckoutMetadataSchema
>;
