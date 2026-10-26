import { z } from "zod";
import type { EventDefinition } from "#app/composition/events.ts";

/** Readiness means provisioning completed, independently of Plan, access, or activation. */
const provisioned = z
  .object({
    type: z.literal("organization.provisioned"),
    version: z.literal(1),
    subjectId: z.string().min(1),
    data: z.object({ organizationId: z.string().min(1) }).strict(),
  })
  .strict();
export type OrganizationReadinessEvent = z.infer<typeof provisioned>;
export const organizationReadinessEventDefinitions = [
  {
    type: "organization.provisioned",
    version: 1,
    parse: (input: unknown) => provisioned.parse(input),
  },
] satisfies readonly EventDefinition<OrganizationReadinessEvent>[];

export function organizationProvisioned(organizationId: string): OrganizationReadinessEvent {
  return {
    type: "organization.provisioned",
    version: 1,
    subjectId: organizationId,
    data: { organizationId },
  };
}
