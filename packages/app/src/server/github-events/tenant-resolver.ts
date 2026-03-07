import { getActiveTenantForGithubInstallation } from "@/data/tenants";
import { getGitHubEventsConfig } from "./config";
import { TerminalEventError } from "./types";

type CacheEntry = {
  tenantId: number;
  expiresAt: number;
};

export class TenantResolver {
  private readonly cache = new Map<number, CacheEntry>();

  constructor(private readonly ttlMs: number) {}

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

    if (this.ttlMs > 0) {
      this.cache.set(installationId, {
        tenantId,
        expiresAt: now + this.ttlMs,
      });
    }

    return tenantId;
  }
}

let tenantResolver: TenantResolver | undefined;

export function getTenantResolver(): TenantResolver {
  if (!tenantResolver) {
    tenantResolver = new TenantResolver(
      getGitHubEventsConfig().tenantCacheTTLms,
    );
  }

  return tenantResolver;
}
