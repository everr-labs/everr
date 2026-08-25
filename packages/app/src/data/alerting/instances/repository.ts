import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { alertInstances } from "@/db/schema";

export async function listAlerts(organizationId: string) {
  const rows = await db
    .select()
    .from(alertInstances)
    .where(eq(alertInstances.organizationId, organizationId))
    .orderBy(sql`${alertInstances.lastSeenAt} desc nulls last`);
  return rows.map((row) => ({
    key: `${row.alertDefinitionId}:${row.fingerprint}`,
    fingerprint: row.fingerprint,
    rule: row.alertDefinitionId,
    tenant: row.organizationId,
    status: row.status,
    labels: row.labels,
    value: row.value,
    pending_since: row.pendingSince?.toISOString() ?? null,
    active_since: row.activeSince?.toISOString() ?? null,
    last_seen: row.lastSeenAt?.toISOString() ?? null,
    absent_count: row.absentCount,
  }));
}
