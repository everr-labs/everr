import { z } from "zod";
import type { BusinessEventDefinition, BusinessEvents } from "#app/composition/business-events.ts";

/** Readiness means provisioning completed, independently of Plan, access, or activation. */
const provisioned = z
  .object({
    type: z.literal("organization.provisioned"),
    version: z.literal(1),
    subjectId: z.string().min(1),
    data: z.object({ organizationId: z.string().min(1) }).strict(),
  })
  .strict();
export type OrganizationReadinessFact = z.infer<typeof provisioned>;
export const organizationReadinessEventDefinitions = [
  {
    type: "organization.provisioned",
    version: 1,
    parse: (input: unknown) => provisioned.parse(input),
  },
] satisfies readonly BusinessEventDefinition<OrganizationReadinessFact>[];

export function publishOrganizationProvisioned(
  events: BusinessEvents<OrganizationReadinessFact>,
  organizationId: string,
): void {
  try {
    events.publish({
      type: "organization.provisioned",
      version: 1,
      subjectId: organizationId,
      data: { organizationId },
    });
  } catch {
    /* Publication cannot change committed readiness. The runtime owns diagnostics. */
  }
}
