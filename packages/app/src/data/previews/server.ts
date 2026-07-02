import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { previews } from "@/db/schema";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

/** Active previews for the switcher: one entry per name, freshest first. */
export const listPreviews = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context }) => {
  const orgId = context.session.session.activeOrganizationId;
  const rows = await db
    .select({ name: previews.name, lastAppliedAt: previews.lastAppliedAt })
    .from(previews)
    .where(eq(previews.organizationId, orgId))
    .orderBy(desc(previews.lastAppliedAt));

  // A preview may span several repoids (same branch name in several repos);
  // the switcher shows one entry per name.
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.name)) return false;
    seen.add(row.name);
    return true;
  });
});
