import { z } from "zod";
import type { EventDefinition } from "@everr/app/composition";

const id = z.string().trim().min(1).max(512);
const milestoneData = z
  .object({
    organizationId: id,
    ruleVersion: z.literal(1),
    observedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const milestone = z.object({ version: z.literal(1), subjectId: id, data: milestoneData });
const firstQueryable = milestone.extend({ type: z.literal("telemetry.first_queryable") }).strict();
const activated = milestone.extend({ type: z.literal("organization.activated") }).strict();
export type OrganizationMilestoneEvent = z.infer<typeof firstQueryable | typeof activated>;
export const organizationMilestoneDefinitions = [firstQueryable, activated].map((schema) => ({
  type: schema.shape.type.value,
  version: 1,
  parse: (input: unknown) => schema.parse(input),
})) satisfies readonly EventDefinition<OrganizationMilestoneEvent>[];
