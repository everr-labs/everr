import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { previews } from "@/db/schema";

/**
 * Repoids a preview covers — the overlay replacement boundary.
 *
 * Server-only: this touches `db` at the top level, so it must NOT live in a
 * module a client component imports. It sits apart from `server.ts` (the
 * `listPreviews` server fn, which the sidebar switcher imports) precisely so
 * that client import can't drag the Postgres driver into the browser bundle —
 * see the server-fn client-bundle gotcha.
 */
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
