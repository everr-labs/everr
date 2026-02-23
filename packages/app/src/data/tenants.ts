import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { githubInstallationTenants, tenants } from "@/db/schema";

export class GithubInstallationAlreadyLinkedError extends Error {
  constructor() {
    super("GitHub installation is already linked to another tenant.");
    this.name = "GithubInstallationAlreadyLinkedError";
  }
}

export async function ensureTenantForOrganizationId(organizationId: string) {
  await db
    .insert(tenants)
    .values({
      externalId: organizationId,
    })
    .onConflictDoNothing({
      target: tenants.externalId,
    });

  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.externalId, organizationId))
    .limit(1);

  if (!tenant) {
    throw new Error("Failed to resolve tenant for organization.");
  }

  return tenant.id;
}

export async function getTenantForOrganizationId(
  organizationId: string,
): Promise<number | null> {
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.externalId, organizationId))
    .limit(1);

  return tenant?.id ?? null;
}

export async function linkGithubInstallationToTenant(
  githubInstallationId: number,
  tenantId: number,
) {
  const inserted = await db
    .insert(githubInstallationTenants)
    .values({
      githubInstallationId,
      tenantId,
    })
    .onConflictDoNothing({
      target: githubInstallationTenants.githubInstallationId,
    })
    .returning({
      githubInstallationId: githubInstallationTenants.githubInstallationId,
    });

  if (inserted.length > 0) {
    return;
  }

  const [existing] = await db
    .select({ tenantId: githubInstallationTenants.tenantId })
    .from(githubInstallationTenants)
    .where(
      eq(githubInstallationTenants.githubInstallationId, githubInstallationId),
    )
    .limit(1);

  if (!existing) {
    throw new Error(
      "Failed to resolve installation mapping after insert conflict.",
    );
  }

  if (existing.tenantId !== tenantId) {
    throw new GithubInstallationAlreadyLinkedError();
  }
}

export async function unlinkGithubInstallation(githubInstallationId: number) {
  await db
    .delete(githubInstallationTenants)
    .where(
      eq(githubInstallationTenants.githubInstallationId, githubInstallationId),
    );
}
