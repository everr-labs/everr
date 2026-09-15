import { env } from "@/env";

export class UnknownPolarProductError extends Error {
  name = "UnknownPolarProductError";

  constructor(productId: string) {
    super(`Polar Product ${productId} is not configured for this deployment.`);
  }
}

class PolarProductPlanMismatchError extends Error {
  name = "PolarProductPlanMismatchError";

  constructor(productId: string, expectedPlan: BillablePlan) {
    super(
      `Polar Product ${productId} does not grant the ${expectedPlan} Plan.`,
    );
  }
}

function productIds(value: string | undefined) {
  return value
    ?.split(",")
    .map((productId) => productId.trim())
    .filter((productId) => productId.length > 0);
}

export type BillablePlan = "pro";

function billingCatalog() {
  return [
    {
      plan: "pro",
      checkoutProductId: env.POLAR_PRO_PRODUCT_ID,
      acceptedProductIds: Array.from(
        new Set([
          env.POLAR_PRO_PRODUCT_ID,
          ...(productIds(env.POLAR_PRO_LEGACY_PRODUCT_IDS) ?? []),
        ]),
      ),
    },
  ] as const;
}

export function polarProductIdForPlan(plan: BillablePlan) {
  const entry = billingCatalog().find((candidate) => candidate.plan === plan);
  if (!entry) throw new Error(`No Polar Product is configured for ${plan}.`);
  return entry.checkoutProductId;
}

export function planForPolarProductId(productId: string): BillablePlan {
  const entry = billingCatalog().find((candidate) =>
    candidate.acceptedProductIds.includes(productId),
  );
  if (!entry) throw new UnknownPolarProductError(productId);
  return entry.plan;
}

export function assertPolarProductGrantsPlan(
  productId: string,
  expectedPlan: BillablePlan,
) {
  if (planForPolarProductId(productId) !== expectedPlan) {
    throw new PolarProductPlanMismatchError(productId, expectedPlan);
  }
}
