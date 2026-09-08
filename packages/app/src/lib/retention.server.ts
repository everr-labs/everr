import QuickLRU from "quick-lru";
import { readOrgEntitlement } from "@/lib/billing-data.server";
import { resolveRetention, type TenantRetention } from "@/lib/retention";

// Share in-flight lookups and evict failures. Combined with the collector
// cache, this 30-second window lets tier changes propagate in about a minute.
const cache = new QuickLRU<string, Promise<TenantRetention>>({
  maxSize: 1_000,
  maxAge: 30_000,
});

export function retentionForOrg(orgId: string): Promise<TenantRetention> {
  const cached = cache.get(orgId);
  if (cached) return cached;

  const pending = readOrgEntitlement(orgId).then(({ tier }) =>
    resolveRetention(tier),
  );
  pending.catch(() => cache.delete(orgId));
  cache.set(orgId, pending);
  return pending;
}
