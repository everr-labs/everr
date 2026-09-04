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
const CACHE_TTL_MS = 30_000;
const cache = new Map<
  string,
  { retention: TenantRetention; expiresAt: number }
>();

export async function retentionForOrg(orgId: string): Promise<TenantRetention> {
  const now = Date.now();
  const cached = cache.get(orgId);
  if (cached && cached.expiresAt > now) return cached.retention;

  const { tier } = await readOrgEntitlement(orgId);
  const retention = resolveRetention(tier);
  cache.set(orgId, { retention, expiresAt: now + CACHE_TTL_MS });
  return retention;
}
