import { eq } from "drizzle-orm";
import { ClickhouseProvisioningPendingError } from "@/common/clickhouse-provisioning";
import { db } from "@/db/client";
import { organization } from "@/db/schema";

export async function assertClickhouseReady(
  organizationId: string,
): Promise<void> {
  const [org] = await db
    .select({ ready: organization.clickhouseReady })
    .from(organization)
    .where(eq(organization.id, organizationId));
  if (!org) throw new Error("Organization no longer exists.");
  if (!org.ready) throw new ClickhouseProvisioningPendingError();
}
