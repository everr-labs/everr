import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { orgSubscription } from "@/db/schema";
import type { Tier } from "@/lib/retention";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

// Keep paid-through retention during payment retries or scheduled cancellation:
// retention stamped at ingestion cannot be extended later.
const PAID_THROUGH_STATUSES = new Set(["past_due", "unpaid", "canceled"]);

type SubscriptionTierInput = {
  status: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean | null;
};

function tierForSubscription(row: SubscriptionTierInput | undefined): Tier {
  if (!row?.status) return "free";
  if (ACTIVE_STATUSES.has(row.status)) return "pro";
  if (!PAID_THROUGH_STATUSES.has(row.status)) return "free";
  // A cancellation scheduled for the period end keeps the paid period;
  // an immediate revoke leaves cancelAtPeriodEnd false and ends it now.
  if (row.status === "canceled" && !row.cancelAtPeriodEnd) return "free";
  return row.currentPeriodEnd && row.currentPeriodEnd > new Date()
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
    tier: tierForSubscription(row),
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
}
