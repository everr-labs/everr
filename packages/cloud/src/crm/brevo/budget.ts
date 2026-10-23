import type { Database } from "@everr/app/db/database";
import { sql } from "drizzle-orm";
import { crmBrevoBudget } from "../../db/schema/crm";

type Group = "contacts" | "general";
type Permit = { allowed: true } | { allowed: false; retryAt: Date };
export type BrevoBudget = {
  acquire(group: Group): Promise<Permit>;
  cooldown(group: Group, delayMs: number): Promise<void>;
};

/** Atomic DB coordination. No source transaction survives a permit call. */
export function createBrevoBudget(database: Database, accountScope: string): BrevoBudget {
  if (!accountScope.trim()) throw new Error("Brevo account scope is required.");
  return {
    async acquire(group) {
      // Even spacing conservatively meets both rolling hourly and per-second limits.
      const intervalMs = group === "contacts" ? 100 : 36_000;
      const rows = await database
        .insert(crmBrevoBudget)
        .values({
          accountScope,
          group,
          nextAllowedAt: sql`clock_timestamp() + ${intervalMs} * interval '1 millisecond'`,
        })
        .onConflictDoUpdate({
          target: [crmBrevoBudget.accountScope, crmBrevoBudget.group],
          set: {
            nextAllowedAt: sql`clock_timestamp() + ${intervalMs} * interval '1 millisecond'`,
          },
          setWhere: sql`${crmBrevoBudget.nextAllowedAt} <= clock_timestamp()`,
        })
        .returning();
      if (rows.length) return { allowed: true };
      const [row] = await database
        .select()
        .from(crmBrevoBudget)
        .where(
          sql`${crmBrevoBudget.accountScope} = ${accountScope} and ${crmBrevoBudget.group} = ${group}`,
        );
      if (!row) throw new Error("Brevo quota unavailable.");
      return { allowed: false, retryAt: row.nextAllowedAt };
    },
    async cooldown(group, delayMs) {
      if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error("Invalid Brevo cooldown.");
      const until = sql`clock_timestamp() + ${Math.ceil(delayMs)} * interval '1 millisecond'`;
      await database
        .insert(crmBrevoBudget)
        .values({ accountScope, group, nextAllowedAt: until })
        .onConflictDoUpdate({
          target: [crmBrevoBudget.accountScope, crmBrevoBudget.group],
          set: { nextAllowedAt: sql`greatest(${crmBrevoBudget.nextAllowedAt}, ${until})` },
        });
    },
  };
}
