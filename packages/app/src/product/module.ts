import QuickLRU from "quick-lru";
import type { ProductPolicy } from "../composition/policy";
import type { TenantRetention } from "../composition/retention";

export interface Product {
  forOrganization: ProductPolicy["forOrganization"];
  canInviteMembers(orgId: string): Promise<boolean>;
  retentionForOrg(orgId: string): Promise<TenantRetention>;
}

/** Each composition owns its policy and cache; no process-wide registration. */
export function createProduct(policy: ProductPolicy): Product {
  // Share in-flight lookups and evict failures. Combined with the collector
  // cache, this lets retention changes propagate in about a minute.
  const cache = new QuickLRU<string, Promise<TenantRetention>>({
    maxSize: 1_000,
    maxAge: 30_000,
  });

  return {
    forOrganization: (orgId) => policy.forOrganization(orgId),
    async canInviteMembers(orgId) {
      return (await policy.forOrganization(orgId)).canInviteMembers;
    },
    retentionForOrg(orgId) {
      const cached = cache.get(orgId);
      if (cached) return cached;
      const pending = policy
        .forOrganization(orgId)
        .then(({ retention }) => retention);
      pending.catch(() => cache.delete(orgId));
      cache.set(orgId, pending);
      return pending;
    },
  };
}
