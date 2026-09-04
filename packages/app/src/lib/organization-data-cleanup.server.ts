import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  alertChannels,
  alertDefaultChannels,
  alertDefaultDestinations,
  alertDefinitions,
  alertDeliveries,
  alertEvents,
  alertInstances,
  alertNotificationGroups,
  alertSilences,
  apikey,
  dashboards,
  githubInstallationOrganizations,
  previews,
  runbooks,
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
      .delete(alertDefaultChannels)
      .where(eq(alertDefaultChannels.organizationId, organizationId));
    await tx
      .delete(alertDefaultDestinations)
      .where(eq(alertDefaultDestinations.organizationId, organizationId));
    await tx
      .delete(alertChannels)
      .where(eq(alertChannels.organizationId, organizationId));
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
    // Nothing cascades into these three from any organization table, so
    // skipping them leaves orphans no retention path ever revisits: the
    // preview sweeper works per organization, and these rows' organization no
    // longer exists. Children before `previews`, so nothing relies on the
    // cascade.
    await tx
      .delete(dashboards)
      .where(eq(dashboards.organizationId, organizationId));
    await tx
      .delete(runbooks)
      .where(eq(runbooks.organizationId, organizationId));
    await tx
      .delete(previews)
      .where(eq(previews.organizationId, organizationId));
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
