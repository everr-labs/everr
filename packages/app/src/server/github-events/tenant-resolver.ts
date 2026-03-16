import { getActiveTenantForGithubInstallation } from "@/data/tenants";
import { GH_EVENTS_CONFIG } from "./config";
import { TerminalEventError } from "./types";

const tenantCache = new Map<number, { tenantId: number; expiresAt: number }>();

export async function resolveTenantId(installationId: number): Promise<number> {
  const now = Date.now();
  const cached = tenantCache.get(installationId);
  if (cached && cached.expiresAt > now) return cached.tenantId;

  const tenantId = await getActiveTenantForGithubInstallation(installationId);
  if (!tenantId) throw new TerminalEventError("tenant not found");

  tenantCache.set(installationId, {
    tenantId,
    expiresAt: now + GH_EVENTS_CONFIG.tenantCacheTTLms,
  });

  return tenantId;
}
