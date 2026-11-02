import { organization } from "@everr/app/db/schema";
import { sql } from "drizzle-orm";
import { parseOrganizationMetadata } from "./metadata";
import { COMPANY_ID_METADATA } from "../crm/metadata";

export const organizationProvisioningPending = sql<boolean>`
  ${organization.metadata}::jsonb -> 'clickhouseReady' = 'false'::jsonb
`;

export const provisionedOrganizationMetadata = sql<string>`
  (coalesce(${organization.metadata}::jsonb, '{}'::jsonb)
    || '{"clickhouseReady":true}'::jsonb)::text
`;

// Better Auth accepts replacement metadata. Preserve the server-owned flag in
// the same SQL update so a concurrent worker completion cannot be overwritten.
export function preserveOrganizationProvisioningStatus(
  update: Record<string, unknown>,
): Record<string, unknown> {
  if (update.metadata === undefined) return update;
  const {
    clickhouseReady: _ignored,
    [COMPANY_ID_METADATA]: _companyId,
    ...metadata
  } = parseOrganizationMetadata(update.metadata);
  return {
    ...update,
    metadata: sql<string>`(${JSON.stringify(metadata)}::jsonb
      || jsonb_build_object('clickhouseReady',
        coalesce(${organization.metadata}::jsonb -> 'clickhouseReady', 'true'::jsonb))
      || CASE WHEN ${organization.metadata}::jsonb ? ${COMPANY_ID_METADATA}
        THEN jsonb_build_object(${COMPANY_ID_METADATA}::text, ${organization.metadata}::jsonb -> ${COMPANY_ID_METADATA})
        ELSE '{}'::jsonb END)::text`,
  };
}
