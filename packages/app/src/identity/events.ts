import { z } from "zod";
import type { EventDefinition } from "#app/composition/events.ts";

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
export type UserEvent = z.infer<typeof created | typeof updated | typeof verified | typeof deleted>;
export const userEventDefinitions = [created, updated, verified, deleted].map((schema) => ({
  type: schema.shape.type.value,
  version: 1,
  parse: (input: unknown) => schema.parse(input),
})) satisfies readonly EventDefinition<UserEvent>[];

export function userCreated(userId: string, emailVerified: boolean): UserEvent {
  return {
    type: "identity.user.created",
    version: 1,
    subjectId: userId,
    data: { userId, emailVerified },
  };
}
export function userChanged(
  type: Exclude<UserEvent["type"], "identity.user.created">,
  userId: string,
): UserEvent {
  return { type, version: 1, subjectId: userId, data: { userId } };
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
export type OrganizationEvent = z.infer<
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
})) satisfies readonly EventDefinition<OrganizationEvent>[];

const membershipEndpoints = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1),
  })
  .strict();
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
  .extend({
    type: z.literal("membership.updated"),
    data: membershipData.extend({ previous: membershipEndpoints.optional() }),
  })
  .strict();
const membershipRemoved = base
  .extend({ type: z.literal("membership.removed"), data: membershipData })
  .strict();
export type MembershipEvent = z.infer<
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
})) satisfies readonly EventDefinition<MembershipEvent>[];

export type IdentityEvent = UserEvent | OrganizationEvent | MembershipEvent;
/** Parent deletion facts require consumers to clean up all associations for that parent.
 * Cascaded rows do not produce invented membership.removed facts. Explicit member
 * deletes retain their relationship IDs before the source rows disappear.
 */
export function organizationChanged(
  type: OrganizationEvent["type"],
  organizationId: string,
): OrganizationEvent {
  return { type, version: 1, subjectId: organizationId, data: { organizationId } };
}
export function membershipChanged(
  type: MembershipEvent["type"],
  member: { id: string; organizationId: string; userId: string },
  previous?: { organizationId: string; userId: string },
): MembershipEvent {
  return {
    type,
    version: 1,
    subjectId: member.id,
    data: {
      membershipId: member.id,
      organizationId: member.organizationId,
      userId: member.userId,
      ...(type === "membership.updated" &&
      previous &&
      (previous.organizationId !== member.organizationId || previous.userId !== member.userId)
        ? { previous: { organizationId: previous.organizationId, userId: previous.userId } }
        : {}),
    },
  };
}
