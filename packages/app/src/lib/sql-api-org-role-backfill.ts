import { db } from "@/db/client";
import { organization } from "@/db/schema";
import { provisionSqlApiOrgRole } from "@/lib/clickhouse";

export async function provisionSqlApiOrgRolesForExistingOrganizations(): Promise<void> {
  const organizations = await db
    .select({ id: organization.id })
    .from(organization);

  for (const { id } of organizations) {
    await provisionSqlApiOrgRole(id);
  }
}
