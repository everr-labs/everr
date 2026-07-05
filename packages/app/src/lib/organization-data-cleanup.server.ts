import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { apikey, githubInstallationOrganizations, workflowJobs, workflowRuns } from "@/db/schema";

export async function deletePostgresOrganizationData(organizationId: string): Promise<void> {
  if (!organizationId) {
    throw new Error("Missing organization id");
  }

  await db.transaction(async (tx) => {
    await tx.delete(workflowJobs).where(eq(workflowJobs.organizationId, organizationId));
    await tx.delete(workflowRuns).where(eq(workflowRuns.organizationId, organizationId));
    await tx
      .delete(githubInstallationOrganizations)
      .where(eq(githubInstallationOrganizations.organizationId, organizationId));
    await tx
      .delete(apikey)
      .where(and(eq(apikey.configId, "ingest"), eq(apikey.referenceId, organizationId)));
  });
}
