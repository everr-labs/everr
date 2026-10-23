import { z } from "zod";
import type { BusinessEventDefinition, BusinessEvents } from "#app/composition/business-events.ts";

const userData = z.object({ userId: z.string().min(1) }).strict();
const base = z.object({
  version: z.literal(1),
  subjectId: z.string().min(1),
  actorId: z.string().min(1).optional(),
});
const created = base
  .extend({
    type: z.literal("identity.user.created"),
    data: userData.extend({ emailVerified: z.boolean() }),
  })
  .strict();
const updated = base.extend({ type: z.literal("identity.user.updated"), data: userData }).strict();
const verified = base
  .extend({ type: z.literal("identity.email.verified"), data: userData })
  .strict();
const deleted = base.extend({ type: z.literal("identity.user.deleted"), data: userData }).strict();
export type UserFact = z.infer<typeof created | typeof updated | typeof verified | typeof deleted>;
export const userEventDefinitions = [created, updated, verified, deleted].map((schema) => ({
  type: schema.shape.type.value,
  version: 1,
  parse: (input: unknown) => schema.parse(input),
})) satisfies readonly BusinessEventDefinition<UserFact>[];

export function userCreated(userId: string, emailVerified: boolean): UserFact {
  return {
    type: "identity.user.created",
    version: 1,
    subjectId: userId,
    data: { userId, emailVerified },
  };
}
export function userChanged(
  type: Exclude<UserFact["type"], "identity.user.created">,
  userId: string,
): UserFact {
  return { type, version: 1, subjectId: userId, data: { userId } };
}

/** An injected publisher must obey the same nonthrowing boundary as the runtime publisher. */
export function publishUserFact(events: BusinessEvents<UserFact>, fact: UserFact): void {
  publishIdentityFact(events, fact);
}

const organizationData = z.object({ organizationId: z.string().min(1) }).strict();
const organizationCreated = base
  .extend({ type: z.literal("organization.created"), data: organizationData })
  .strict();
const organizationUpdated = base
  .extend({ type: z.literal("organization.updated"), data: organizationData })
  .strict();
const organizationDeleted = base
  .extend({ type: z.literal("organization.deleted"), data: organizationData })
  .strict();
export type OrganizationFact = z.infer<
  typeof organizationCreated | typeof organizationUpdated | typeof organizationDeleted
>;
export const organizationEventDefinitions = [
  organizationCreated,
  organizationUpdated,
  organizationDeleted,
].map((schema) => ({
  type: schema.shape.type.value,
  version: 1,
  parse: (input: unknown) => schema.parse(input),
})) satisfies readonly BusinessEventDefinition<OrganizationFact>[];

const membershipData = z
  .object({
    membershipId: z.string().min(1),
    organizationId: z.string().min(1),
    userId: z.string().min(1),
  })
  .strict();
const membershipAdded = base
  .extend({ type: z.literal("membership.added"), data: membershipData })
  .strict();
const membershipUpdated = base
  .extend({ type: z.literal("membership.updated"), data: membershipData })
  .strict();
const membershipRemoved = base
  .extend({ type: z.literal("membership.removed"), data: membershipData })
  .strict();
export type MembershipFact = z.infer<
  typeof membershipAdded | typeof membershipUpdated | typeof membershipRemoved
>;
export const membershipEventDefinitions = [
  membershipAdded,
  membershipUpdated,
  membershipRemoved,
].map((schema) => ({
  type: schema.shape.type.value,
  version: 1,
  parse: (input: unknown) => schema.parse(input),
})) satisfies readonly BusinessEventDefinition<MembershipFact>[];

export type IdentityFact = UserFact | OrganizationFact | MembershipFact;
export const identityEventDefinitions = [
  ...userEventDefinitions,
  ...organizationEventDefinitions,
  ...membershipEventDefinitions,
];

export function organizationChanged(
  type: OrganizationFact["type"],
  organizationId: string,
): OrganizationFact {
  return { type, version: 1, subjectId: organizationId, data: { organizationId } };
}
export function membershipChanged(
  type: MembershipFact["type"],
  member: { id: string; organizationId: string; userId: string },
): MembershipFact {
  return {
    type,
    version: 1,
    subjectId: member.id,
    data: { membershipId: member.id, organizationId: member.organizationId, userId: member.userId },
  };
}

/** Parent deletion facts require consumers to clean up all associations for that parent.
 * Cascaded rows do not produce invented membership.removed facts. Explicit member
 * deletes retain their relationship IDs before the source rows disappear.
 */
export function publishIdentityFact<F extends IdentityFact>(
  events: BusinessEvents<F>,
  fact: F,
): void {
  try {
    events.publish(fact);
  } catch {
    /* Publication cannot change an already committed identity result. */
  }
}
