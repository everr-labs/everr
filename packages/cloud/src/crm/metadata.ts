import type { Database } from "@everr/app/db/database";
import { organization } from "@everr/app/db/schema";
import { eq, sql } from "drizzle-orm";
import { parseOrganizationMetadata } from "../organization-provisioning/metadata";

export const COMPANY_ID_METADATA = "everr.crm.brevoCompanyId";

export function readCompanyId(metadata: unknown): string | undefined {
  const value = parseOrganizationMetadata(metadata)[COMPANY_ID_METADATA];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Update only the server-owned mapping, without auth hooks or lifecycle events. */
export async function saveCompanyId(database: Database, organizationId: string, companyId: string) {
  await database
    .update(organization)
    .set({
      metadata: sql<string>`(coalesce(${organization.metadata}::jsonb, '{}'::jsonb)
      || jsonb_build_object(${COMPANY_ID_METADATA}::text, ${companyId}::text))::text`,
    })
    .where(eq(organization.id, organizationId));
}
