import * as z from "zod";

const common = {
  everrPurpose: z.literal("create_pro_organization"),
  everrOwnerId: z.string().min(1),
  everrOrganizationName: z.string().min(1),
  everrOrganizationSlug: z.string().min(1),
};

export const ProOrganizationCheckoutMetadataSchema = z.discriminatedUnion(
  "everrSchemaVersion",
  [
    z.object({ ...common, everrSchemaVersion: z.literal(1) }),
    z.object({
      ...common,
      everrSchemaVersion: z.literal(2),
      everrOrganizationId: z.string().min(1),
    }),
  ],
);

export type ProOrganizationCheckoutMetadata = z.infer<
  typeof ProOrganizationCheckoutMetadataSchema
>;
export type ProOrganizationCheckoutMetadataV2 = Extract<
  ProOrganizationCheckoutMetadata,
  { everrSchemaVersion: 2 }
>;
