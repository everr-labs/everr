import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  apikey,
  githubInstallationOrganizations,
  member,
  serviceAccount,
  user,
  workflowJobs,
  workflowRuns,
} from "@/db/schema";

// A service account belongs to an organization through its member row, so
// deleting the organization leaves its machine users behind: the member rows
// cascade away, the user rows do not. This deletes those users, which
// cascades to their service accounts, secrets, and tokens. It runs before the
// organization is deleted, while the member rows still say who belongs to it.
export async function deleteOrganizationServiceAccounts(
  organizationId: string,
): Promise<void> {
  if (!organizationId) {
    throw new Error("Missing organization id");
  }

  const userIds = await db
    .select({ userId: serviceAccount.userId })
    .from(serviceAccount)
    .innerJoin(
      member,
      and(
        eq(member.userId, serviceAccount.userId),
        eq(member.organizationId, organizationId),
      ),
    );

  if (userIds.length === 0) {
    return;
  }

  await db.delete(user).where(
    inArray(
      user.id,
      userIds.map((row) => row.userId),
    ),
  );
}

export async function deletePostgresOrganizationData(
  organizationId: string,
): Promise<void> {
  if (!organizationId) {
    throw new Error("Missing organization id");
  }

  await db.transaction(async (tx) => {
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
