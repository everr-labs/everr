import { eq } from "drizzle-orm";
import { ClickhouseProvisioningPendingError } from "@/common/clickhouse-provisioning";
import { isOrganizationProvisioned } from "@/common/organization-provisioning";
import { db } from "@/db/client";
import { organization } from "@/db/schema";

export async function assertClickhouseReady(
  organizationId: string,
): Promise<void> {
  const [org] = await db
    .select({ metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, organizationId));
  if (!org) throw new Error("Organization no longer exists.");
  if (!isOrganizationProvisioned(org.metadata))
    throw new ClickhouseProvisioningPendingError();
}
