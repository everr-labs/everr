import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { orgSubscription } from "@/db/schema";
import { upsertTenantRetention } from "@/lib/clickhouse";
import { resolveRetention, type Tier } from "@/lib/retention";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

function tierForSubscription(args: {
  status: string | null | undefined;
}): Tier {
  return args.status && ACTIVE_STATUSES.has(args.status) ? "pro" : "free";
}

export type OrgEntitlement = {
  tier: "free" | "pro";
  status: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

export async function getOrgEntitlement(
  orgId: string,
): Promise<OrgEntitlement> {
  const [row] = await db
    .select()
    .from(orgSubscription)
    .where(eq(orgSubscription.orgId, orgId))
    .limit(1);

  return {
    tier: tierForSubscription({ status: row?.status }),
    status: row?.status ?? null,
    currentPeriodEnd: row?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
  };
}

type SubscriptionUpsert = {
  orgId: string;
  polarSubscriptionId: string;
  polarProductId: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  polarModifiedAt: Date;
};

export async function upsertOrgSubscription(input: SubscriptionUpsert) {
  await db
    .insert(orgSubscription)
    .values(input)
    .onConflictDoUpdate({
      target: orgSubscription.orgId,
      set: {
        polarSubscriptionId: input.polarSubscriptionId,
        polarProductId: input.polarProductId,
        status: input.status,
        currentPeriodEnd: input.currentPeriodEnd,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        polarModifiedAt: input.polarModifiedAt,
        updatedAt: new Date(),
      },
      setWhere: sql`${orgSubscription.polarModifiedAt} < ${input.polarModifiedAt}`,
    });

  // Sync retention from the persisted PG state (not from `input`) so webhook
  // retries after a transient ClickHouse failure still converge — including
  // the case where the staleness guard above blocks the PG update on retry.
  const [current] = await db
    .select({ status: orgSubscription.status })
    .from(orgSubscription)
    .where(eq(orgSubscription.orgId, input.orgId))
    .limit(1);
  if (!current) return;

  const retention = resolveRetention(
    tierForSubscription({ status: current.status }),
  );

  await upsertTenantRetention({
    tenantId: input.orgId,
    tracesDays: retention.tracesDays,
    logsDays: retention.logsDays,
    metricsDays: retention.metricsDays,
  });
}
