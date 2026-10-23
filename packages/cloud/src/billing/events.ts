import type { BusinessEventDefinition, BusinessEvents } from "@everr/app/composition";
import { z } from "zod";

const base = z.object({
  version: z.literal(1),
  subjectId: z.string().min(1),
  actorId: z.string().min(1).optional(),
});
const subscriptionChanged = base
  .extend({
    type: z.literal("billing.subscription.changed"),
    data: z
      .object({ organizationId: z.string().min(1), subscriptionId: z.string().min(1) })
      .strict(),
  })
  .strict();
const plan = z.enum(["hobby", "pro"]);
const planChanged = base
  .extend({
    type: z.literal("organization.plan.changed"),
    data: z.object({ organizationId: z.string().min(1), previousPlan: plan, plan }).strict(),
  })
  .strict();
export type BillingFact = z.infer<typeof subscriptionChanged | typeof planChanged>;
export const billingEventDefinitions = [subscriptionChanged, planChanged].map((schema) => ({
  type: schema.shape.type.value,
  version: 1,
  parse: (input: unknown) => schema.parse(input),
})) satisfies readonly BusinessEventDefinition<BillingFact>[];

export function organizationPlanChanged(
  organizationId: string,
  previousPlan: "hobby" | "pro",
  plan: "hobby" | "pro",
): BillingFact {
  return {
    type: "organization.plan.changed",
    version: 1,
    subjectId: organizationId,
    data: { organizationId, previousPlan, plan },
  };
}

/** Protect committed source results even when an injected publisher violates its contract. */
export function publishBillingFact(events: BusinessEvents<BillingFact>, fact: BillingFact): void {
  try {
    events.publish(fact);
  } catch {
    /* The runtime publisher owns fallible validation, delivery, and diagnostics. */
  }
}
