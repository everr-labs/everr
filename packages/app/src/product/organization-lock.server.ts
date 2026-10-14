import { sql } from "drizzle-orm";
import type { Transaction } from "@/db/client";
export async function lockOrganizationOwnership(
  tx: Transaction,
  userId: string,
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
}
