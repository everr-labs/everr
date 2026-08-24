import type { Tier } from "@/lib/retention";

export const USAGE_METERS = ["traces", "logs", "metrics"] as const;
export type UsageMeter = (typeof USAGE_METERS)[number];

const USAGE_METER_SET = new Set<string>(USAGE_METERS);

export function isUsageMeter(value: string): value is UsageMeter {
  return USAGE_METER_SET.has(value);
}

export const BYTES_PER_GB = 1_000_000_000;
export const PRO_OVERAGE_USD_PER_GB = 0.4;

export type UsageLimit = Readonly<{
  includedGb: number;
  includedBytes: number;
  overageUsdPerGb: number | null;
}>;

export type TenantUsageLimits = Readonly<Record<UsageMeter, UsageLimit>>;

function createSignalLimit(
  includedGb: number,
  overageUsdPerGb: number | null,
): UsageLimit {
  return {
    includedGb,
    includedBytes: includedGb * BYTES_PER_GB,
    overageUsdPerGb,
  };
}

const USAGE_LIMITS_BY_TIER: Record<Tier, TenantUsageLimits> = {
  free: {
    traces: createSignalLimit(5, null),
    logs: createSignalLimit(5, null),
    metrics: createSignalLimit(5, null),
  },
  pro: {
    traces: createSignalLimit(100, PRO_OVERAGE_USD_PER_GB),
    logs: createSignalLimit(100, PRO_OVERAGE_USD_PER_GB),
    metrics: createSignalLimit(100, PRO_OVERAGE_USD_PER_GB),
  },
};

export function resolveUsageLimits(tier: Tier): TenantUsageLimits {
  return USAGE_LIMITS_BY_TIER[tier];
}

export type UsageOverage = Readonly<{
  overageBytes: number;
  overageGb: number;
  costUsd: number | null;
}>;

export function calculateUsageOverage(
  usedBytes: number,
  limit: UsageLimit,
): UsageOverage {
  if (!Number.isFinite(usedBytes) || usedBytes < 0) {
    throw new RangeError("Usage bytes must be a non-negative finite number");
  }

  const overageBytes = Math.max(0, usedBytes - limit.includedBytes);
  const overageGb = overageBytes / BYTES_PER_GB;

  return {
    overageBytes,
    overageGb,
    costUsd:
      limit.overageUsdPerGb === null ? null : overageGb * limit.overageUsdPerGb,
  };
}
