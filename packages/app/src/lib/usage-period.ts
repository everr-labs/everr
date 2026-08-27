import { isActiveSubscriptionStatus, type Tier } from "@/lib/retention";

export type UsagePeriodEntitlement = Readonly<{
  tier: Tier;
  status: string | null;
  currentPeriodStart: Date | string | null;
  currentPeriodEnd: Date | string | null;
}>;

export type UsagePeriod = Readonly<{
  from: Date;
  to: Date;
  source: "subscription" | "calendar_month";
}>;

function validDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function resolveUsagePeriod(
  entitlement: UsagePeriodEntitlement,
  now: Date,
): UsagePeriod {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("Current time must be a valid date");
  }

  const subscriptionStart = validDate(entitlement.currentPeriodStart);
  const subscriptionEnd = validDate(entitlement.currentPeriodEnd);
  if (
    entitlement.tier === "pro" &&
    isActiveSubscriptionStatus(entitlement.status) &&
    subscriptionStart !== null &&
    subscriptionEnd !== null &&
    subscriptionStart <= now &&
    now < subscriptionEnd
  ) {
    return {
      from: subscriptionStart,
      to: subscriptionEnd,
      source: "subscription",
    };
  }

  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    source: "calendar_month",
  };
}
