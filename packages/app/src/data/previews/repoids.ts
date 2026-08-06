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
  const rows = await getPreviewScopes(orgId, preview);
  return new Set(rows.map((row) => row.repoid));
}

export async function getPreviewScopes(
  orgId: string,
  preview: string,
): Promise<{ id: string; repoid: string }[]> {
  const rows = await db
    .select({ id: previews.id, repoid: previews.repoid })
    .from(previews)
    .where(and(eq(previews.organizationId, orgId), eq(previews.name, preview)));
  return rows;
}
