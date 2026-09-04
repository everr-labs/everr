import { readOrgEntitlement } from "@/lib/billing-data.server";
import { resolveRetention, type TenantRetention } from "@/lib/retention";

// Retention is stamped on telemetry by the collector at ingestion, from the
// values this returns. Callers: the API key verify endpoint, the GitHub
// webhook forwarder, and alert history inserts.
export async function retentionForOrg(orgId: string): Promise<TenantRetention> {
  const { tier } = await readOrgEntitlement(orgId);
  return resolveRetention(tier);
}
