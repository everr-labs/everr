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
  try {
    events.publish(fact);
  } catch {
    /* Publication cannot change an already committed identity result. */
  }
}
