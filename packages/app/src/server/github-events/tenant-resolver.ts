import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { githubInstallationOrganizations } from "@/db/schema";
import { GH_EVENTS_CONFIG } from "./config";
import { TerminalEventError } from "./types";

const cache = new Map<number, { organizationId: string; expiresAt: number }>();

export async function resolveOrganizationId(
  installationId: number,
): Promise<string> {
  const now = Date.now();
  const cached = cache.get(installationId);
  if (cached && cached.expiresAt > now) return cached.organizationId;

  const [mapping] = await db
    .select({
      organizationId: githubInstallationOrganizations.organizationId,
    })
    .from(githubInstallationOrganizations)
    .where(
      and(
        eq(
          githubInstallationOrganizations.githubInstallationId,
          installationId,
        ),
        eq(githubInstallationOrganizations.status, "active"),
      ),
    )
    .limit(1);

  if (!mapping)
    throw new TerminalEventError("organization not found for installation");

  cache.set(installationId, {
    organizationId: mapping.organizationId,
    expiresAt: now + GH_EVENTS_CONFIG.tenantCacheTTLms,
  });

  return mapping.organizationId;
}
