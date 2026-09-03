import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { orgSubscription } from "@/db/schema";
import { upsertTenantRetention } from "@/lib/clickhouse";
import type { Tier } from "@/lib/retention";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

// Billing has stopped or is being retried, but the customer has already paid
// through currentPeriodEnd. Dropping them to free the moment the webhook lands
// is not recoverable: every app.* row is stamped with its tenant's retention at
// ingest and retention_days is a partition key column, so data ingested inside
// a paid period would keep free-tier retention for good. Over-granting costs
// storage; under-granting deletes data the customer paid to keep.
const PAID_THROUGH_STATUSES = new Set(["past_due", "unpaid", "canceled"]);

function tierForSubscription(args: {
  status: string | null | undefined;
  currentPeriodEnd: Date | null | undefined;
  cancelAtPeriodEnd: boolean | null | undefined;
}): Tier {
  if (!args.status) return "free";
  if (ACTIVE_STATUSES.has(args.status)) return "pro";
  if (!PAID_THROUGH_STATUSES.has(args.status)) return "free";
  // A cancellation scheduled for the period end keeps the paid period;
  // an immediate revoke leaves cancelAtPeriodEnd false and ends it now.
  if (args.status === "canceled" && !args.cancelAtPeriodEnd) return "free";
  return args.currentPeriodEnd && args.currentPeriodEnd > new Date()
    ? "pro"
    : "free";
}

export type OrgEntitlement = {
  tier: "free" | "pro";
  status: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

export async function readOrgEntitlement(
  orgId: string,
): Promise<OrgEntitlement> {
  const [row] = await db
    .select()
    .from(orgSubscription)
    .where(eq(orgSubscription.orgId, orgId))
    .limit(1);

  return {
    tier: tierForSubscription({
      status: row?.status,
      currentPeriodEnd: row?.currentPeriodEnd,
      cancelAtPeriodEnd: row?.cancelAtPeriodEnd,
    }),
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
    .select({
      status: orgSubscription.status,
      currentPeriodEnd: orgSubscription.currentPeriodEnd,
      cancelAtPeriodEnd: orgSubscription.cancelAtPeriodEnd,
    })
    .from(orgSubscription)
    .where(eq(orgSubscription.orgId, input.orgId))
    .limit(1);
  if (!current) return;

  await upsertTenantRetention({
    tenantId: input.orgId,
    tier: tierForSubscription(current),
  });
}
