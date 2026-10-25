import { z } from "zod";
import type { EventDefinition } from "#app/composition/events.ts";

const id = z.string().trim().min(1).max(512);
const scope = { organizationId: id, userId: id, membershipId: id };
/** Server completion evidence only. Never parse a browser/request body into this authority. */
export const usefulConsultation = z
  .object({
    organizationId: id,
    principal: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("member"),
          ...scope,
          authorization: z.literal("current-membership"),
        })
        .strict(),
      z
        .object({
          kind: z.literal("client"),
          organizationId: id,
          clientId: id,
          authorization: z.literal("organization-query"),
        })
        .strict(),
    ]),
    data: z
      .object({
        organizationId: id,
        origin: z.enum(["production", "ci"]),
        provenance: z.literal("own-customer-telemetry"),
      })
      .strict(),
    // A completed server read and explicit useful action are both required.
    completion: z.literal("succeeded"),
    trigger: z.enum(["user", "agent-request"]),
    evidence: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("detail"),
          surface: z.literal("ui"),
          entity: z.enum(["trace", "log", "error", "ci-run"]),
          matchedOwnRecords: z.number().int().positive(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("dashboard"),
          surface: z.literal("ui"),
          initialConsultation: z.literal(true),
          renderedOwnPanels: z.number().int().positive(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("query"),
          surface: z.enum(["cli", "mcp"]),
          purpose: z.literal("telemetry-analysis"),
          matchedOwnRecords: z.number().int().positive(),
        })
        .strict(),
    ]),
  })
  .strict()
  .refine(
    (value) =>
      value.organizationId === value.principal.organizationId &&
      value.organizationId === value.data.organizationId &&
      (value.evidence.surface !== "ui" ||
        (value.principal.kind === "member" && value.trigger === "user")),
    "Consultation scope or surface does not match its authenticated principal",
  );

export type UsefulConsultation = z.infer<typeof usefulConsultation>;
/** Nonthrowing, bounded admission. The completed product action must never await observation. */
export interface UsefulConsultations {
  observe(this: void, observation: UsefulConsultation): void;
  /** Close admission and drain accepted observations for a bounded period. */
  stop(this: void): Promise<void>;
}

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
