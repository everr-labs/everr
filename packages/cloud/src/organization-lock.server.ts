import type { Transaction } from "@everr/app/db/client";
import { sql } from "drizzle-orm";
export async function lockOrganizationOwnership(
  tx: Transaction,
  userId: string,
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
}
