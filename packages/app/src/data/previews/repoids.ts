import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { previews } from "@/db/schema";

// Repoids a preview covers — the overlay's replacement boundary. Server-only
// (touches `db` at module top level; must not be imported by a client
// component — see the server-fn client-bundle gotcha).
export async function getCoveredRepoids(
  orgId: string,
  preview: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ repoid: previews.repoid })
    .from(previews)
    .where(and(eq(previews.organizationId, orgId), eq(previews.name, preview)));
  return new Set(rows.map((row) => row.repoid));
}

/**
 * A preview's registry rows as id → repoid. Resources that live OUTSIDE
 * Postgres (CC alert rules, tagged with the registry id in their everr.preview
 * annotation) can't join the previews table, so their overlay reads resolve
 * the covered ids/repoids through this map instead. Same server-only caveat
 * as above.
 */
export async function getPreviewRegistry(
  orgId: string,
  preview: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: previews.id, repoid: previews.repoid })
    .from(previews)
    .where(and(eq(previews.organizationId, orgId), eq(previews.name, preview)));
  return new Map(rows.map((row) => [row.id, row.repoid]));
}
