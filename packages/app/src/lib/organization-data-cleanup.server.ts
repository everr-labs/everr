import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  alertChannels,
  alertDefinitionChannels,
  alertDefinitions,
  alertDeliveries,
  alertEvents,
  alertInhibitions,
  alertInstances,
  alertNotificationGroups,
  alertReceiverChannels,
  alertReceivers,
  alertRoutes,
  alertSilences,
  apikey,
  githubInstallationOrganizations,
  workflowJobs,
  workflowRuns,
} from "@/db/schema";

export async function deletePostgresOrganizationData(
  organizationId: string,
): Promise<void> {
  if (!organizationId) {
    throw new Error("Missing organization id");
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(alertDeliveries)
      .where(eq(alertDeliveries.organizationId, organizationId));
    await tx
      .delete(alertNotificationGroups)
      .where(eq(alertNotificationGroups.organizationId, organizationId));
    await tx
      .delete(alertReceiverChannels)
      .where(eq(alertReceiverChannels.organizationId, organizationId));
    // The direct rule-to-channel mapping's channel FK does not cascade, so
    // it must clear before alertChannels or the delete below is rejected.
    await tx
      .delete(alertDefinitionChannels)
      .where(eq(alertDefinitionChannels.organizationId, organizationId));
    await tx
      .delete(alertRoutes)
      .where(eq(alertRoutes.organizationId, organizationId));
    await tx
      .delete(alertChannels)
      .where(eq(alertChannels.organizationId, organizationId));
    await tx
      .delete(alertReceivers)
      .where(eq(alertReceivers.organizationId, organizationId));
    await tx
      .delete(alertInhibitions)
      .where(eq(alertInhibitions.organizationId, organizationId));
    await tx
      .delete(alertSilences)
      .where(eq(alertSilences.organizationId, organizationId));
    await tx
      .delete(alertEvents)
      .where(eq(alertEvents.organizationId, organizationId));
    await tx
      .delete(alertInstances)
      .where(eq(alertInstances.organizationId, organizationId));
    await tx
      .delete(alertDefinitions)
      .where(eq(alertDefinitions.organizationId, organizationId));
    await tx
      .delete(workflowJobs)
      .where(eq(workflowJobs.organizationId, organizationId));
    await tx
      .delete(workflowRuns)
      .where(eq(workflowRuns.organizationId, organizationId));
    await tx
      .delete(githubInstallationOrganizations)
      .where(
        eq(githubInstallationOrganizations.organizationId, organizationId),
      );
    await tx
      .delete(apikey)
      .where(
        and(
          eq(apikey.configId, "ingest"),
          eq(apikey.referenceId, organizationId),
        ),
      );
  });
}
