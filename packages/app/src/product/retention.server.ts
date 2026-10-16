import { productPolicy } from "@app/policy";
import QuickLRU from "quick-lru";
import type { TenantRetention } from "@/product/retention";

// Share in-flight lookups and evict failures. Combined with the collector
// cache, this 30-second window lets policy changes propagate in about a minute.
const cache = new QuickLRU<string, Promise<TenantRetention>>({
  maxSize: 1_000,
  maxAge: 30_000,
});

export function retentionForOrg(orgId: string): Promise<TenantRetention> {
  const cached = cache.get(orgId);
  if (cached) return cached;

  const pending = productPolicy
    .forOrganization(orgId)
    .then(({ retention }) => retention);
  pending.catch(() => cache.delete(orgId));
  cache.set(orgId, pending);
  return pending;
}
