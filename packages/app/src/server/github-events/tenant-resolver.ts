import { getActiveTenantForGithubInstallation } from "@/data/tenants";
import { GH_EVENTS_CONFIG } from "./config";
import { TerminalEventError } from "./types";

type CacheEntry = {
  tenantId: number;
  expiresAt: number;
};

export class TenantResolver {
  private readonly cache = new Map<number, CacheEntry>();

  async resolveTenantId(installationId: number): Promise<number> {
    const now = Date.now();
    const cached = this.cache.get(installationId);
    if (cached && cached.expiresAt > now) {
      return cached.tenantId;
    }

    const tenantId = await getActiveTenantForGithubInstallation(installationId);
    if (!tenantId) {
      throw new TerminalEventError("tenant not found");
    }

    this.cache.set(installationId, {
      tenantId,
      expiresAt: now + GH_EVENTS_CONFIG.tenantCacheTTLms,
    });

    return tenantId;
  }
}

let tenantResolver: TenantResolver | undefined;

export function getTenantResolver(): TenantResolver {
  if (!tenantResolver) {
    tenantResolver = new TenantResolver();
  }

  return tenantResolver;
}
