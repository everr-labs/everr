import QuickLRU from "quick-lru";
import { readOrgEntitlement } from "@/lib/billing-data.server";
import { resolveRetention, type TenantRetention } from "@/lib/retention";

// Retention is stamped on telemetry by the collector at ingestion, from the
// values this returns. Callers: the API key verify endpoint, the GitHub
// webhook forwarder, and alert history inserts.
//
// Cached because all three callers are per-event: the webhook forwarder runs
// once per GitHub event, and the verify endpoint once per collector cache
// miss. The collector caches its own answer for 30 seconds, so this window
// keeps the documented "within about a minute" for a tier change.
//
// The entry is the in-flight promise, so concurrent misses for one org share a
// single query instead of each issuing their own. A rejection is dropped
// rather than cached: a failed lookup must not deny the tenant its retention
// for the rest of the window.
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
