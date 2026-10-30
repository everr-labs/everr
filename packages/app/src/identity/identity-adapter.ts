import type { drizzleAdapter } from "better-auth/adapters/drizzle";
import { inArray } from "drizzle-orm";
import type { IdentityProvider } from "#app/composition/identity-provider.ts";
import type { EventPublisher } from "#app/composition/events.ts";
import { type Database, type DbExecutor, runInTransaction } from "#app/db/database.ts";
import { member, organization, user } from "#app/db/schema/index.ts";
import {
  membershipChanged,
  organizationChanged,
  userChanged,
  userCreated,
  type IdentityEvent,
} from "./events";

type Factory = ReturnType<typeof drizzleAdapter>;
type Adapter = ReturnType<Factory>;
type LifecycleModel = "user" | "organization" | "member";
type Where = Parameters<Adapter["findMany"]>[0]["where"];
type Snapshot =
  | { model: "user"; rows: (typeof user.$inferSelect)[] }
  | { model: "organization"; rows: Pick<typeof organization.$inferSelect, "id">[] }
  | {
      model: "member";
      rows: Pick<typeof member.$inferSelect, "id" | "organizationId" | "userId">[];
    };

function isLifecycleModel(model: string): model is LifecycleModel {
  return model === "user" || model === "organization" || model === "member";
}

function byId(rows: readonly { id: string }[]) {
  return [{ field: "id", operator: "in" as const, value: rows.map(({ id }) => id) }];
}

/**
 * Identity facts belong to the persistence commit, including Better Auth's nested
 * OAuth transactions. Its queued database after-hooks also run after rollback
 * in 1.6.33, so they cannot establish this boundary.
 */
export function identityLifecycleAdapter(
  database: Database,
  factory: (executor: DbExecutor) => Factory,
  events: EventPublisher<IdentityEvent>,
  requests: Pick<IdentityProvider, "withIdentityRequest" | "lockUserLifecycle"> = {
    withIdentityRequest: (run) => run(),
    lockUserLifecycle: async () => {},
  },
): Factory {
  return (options) => {
    const wrap = (executor: DbExecutor, facts?: IdentityEvent[]): Adapter => {
      const adapter = factory(executor)(options);
      const transaction: Adapter["transaction"] = async (run) => {
        if (facts) return runInTransaction(executor, (tx) => run(wrap(tx, facts)));
        return requests.withIdentityRequest(async () => {
          const committed: IdentityEvent[] = [];
          const result = await runInTransaction(executor, (tx) => run(wrap(tx, committed)));
          for (const fact of committed) await events.publish(fact);
          return result;
        });
      };
      const create: Adapter["create"] = async <T extends Record<string, unknown>, R = T>(input: {
        model: string;
        data: Omit<T, "id">;
        select?: string[];
        forceAllowId?: boolean;
      }): Promise<R> => {
        if (!isLifecycleModel(input.model)) return adapter.create<T, R>(input);
        if (!facts) return transaction((tx) => tx.create<T, R>(input));
        const createWithFact = async <C extends { id: string }>(
          fact: (created: R & C) => IdentityEvent,
        ): Promise<R> => {
          const created = await adapter.create<T, R & C>({ ...input, select: undefined });
          facts.push(fact(created));
          if (!input.select?.length) return created;
          return (
            (await adapter.findOne<R>({
              model: input.model,
              where: [{ field: "id", value: created.id }],
              select: input.select,
            })) ?? created
          );
        };
        if (input.model === "organization")
          return createWithFact<{ id: string }>((created) =>
            organizationChanged("organization.created", created.id),
          );
        if (input.model === "member")
          return createWithFact<{ id: string; organizationId: string; userId: string }>((created) =>
            membershipChanged("membership.added", created),
          );
        return createWithFact<{ id: string; emailVerified: boolean }>((created) =>
          userCreated(created.id, created.emailVerified),
        );
      };
      const matchingIds = async (model: LifecycleModel, where: Where) =>
        (
          await adapter.findMany<{ id: string }>({
            model,
            where,
            select: ["id"],
            limit: Number.MAX_SAFE_INTEGER,
          })
        ).map(({ id }) => id);
      const stillMatching = async <Row extends { id: string }>(
        model: LifecycleModel,
        where: Where,
        locked: Row[],
      ): Promise<Row[]> => {
        const matching = new Set(await matchingIds(model, where));
        return locked.filter(({ id }) => matching.has(id));
      };
      const snapshot = async (model: LifecycleModel, where: Where): Promise<Snapshot> => {
        const ids = await matchingIds(model, where);
        if (model === "user") {
          if (!ids.length) return { model, rows: [] };
          for (const id of [...ids].sort()) await requests.lockUserLifecycle(id);
          // Serialize before/after capture so concurrent verification requests see
          // the persisted false-to-true transition exactly once.
          const locked = await executor
            .select()
            .from(user)
            .where(inArray(user.id, ids))
            .orderBy(user.id)
            .for("update");
          return { model, rows: await stillMatching(model, where, locked) };
        }
        if (model === "organization") {
          if (!ids.length) return { model, rows: [] };
          const locked = await executor
            .select({ id: organization.id })
            .from(organization)
            .where(inArray(organization.id, ids))
            .orderBy(organization.id)
            .for("update");
          // The predicate can change while waiting for row locks. Revalidate
          // it before mutating the captured IDs.
          return { model, rows: await stillMatching(model, where, locked) };
        }
        if (!ids.length) return { model, rows: [] };
        const locked = await executor
          .select({ id: member.id, organizationId: member.organizationId, userId: member.userId })
          .from(member)
          .where(inArray(member.id, ids))
          .orderBy(member.id)
          .for("update");
        return { model, rows: await stillMatching(model, where, locked) };
      };
      const updatedFacts = async (before: Snapshot): Promise<IdentityEvent[]> => {
        if (!before.rows.length) return [];
        if (before.model === "organization")
          return before.rows.map(({ id }) => organizationChanged("organization.updated", id));
        if (before.model === "user") {
          const after = await executor
            .select()
            .from(user)
            .where(
              inArray(
                user.id,
                before.rows.map(({ id }) => id),
              ),
            )
            .orderBy(user.id);
          const previous = new Map(before.rows.map((row) => [row.id, row]));
          const updates: IdentityEvent[] = [];
          for (const row of after) {
            updates.push(userChanged("identity.user.updated", row.id));
            if (previous.get(row.id)?.emailVerified === false && row.emailVerified)
              updates.push(userChanged("identity.email.verified", row.id));
          }
          return updates;
        }
        const after = await executor
          .select()
          .from(member)
          .where(
            inArray(
              member.id,
              before.rows.map(({ id }) => id),
            ),
          )
          .orderBy(member.id);
        const previous = new Map(before.rows.map((row) => [row.id, row]));
        return after.map((row) =>
          membershipChanged("membership.updated", row, previous.get(row.id)),
        );
      };
      const deletedFacts = (before: Snapshot): IdentityEvent[] => {
        if (before.model === "user")
          return before.rows.map(({ id }) => userChanged("identity.user.deleted", id));
        if (before.model === "organization")
          return before.rows.map(({ id }) => organizationChanged("organization.deleted", id));
        return before.rows.map((row) => membershipChanged("membership.removed", row));
      };
      const update: Adapter["update"] = async <T>(
        input: Parameters<Adapter["update"]>[0],
      ): Promise<T | null> => {
        if (!isLifecycleModel(input.model)) return adapter.update<T>(input);
        if (!facts) return transaction((tx) => tx.update<T>(input));
        const before = await snapshot(input.model, input.where);
        if (!before.rows.length) return null;
        const result = await adapter.update<T>({ ...input, where: byId(before.rows) });
        if (result) facts.push(...(await updatedFacts(before)));
        return result;
      };
      const remove: Adapter["delete"] = async (input) => {
        if (!isLifecycleModel(input.model)) return adapter.delete(input);
        if (!facts) return transaction((tx) => tx.delete(input));
        const before = await snapshot(input.model, input.where);
        if (!before.rows.length) return;
        const scoped = { ...input, where: byId(before.rows) };
        // Providers use their bulk path to retain cleanup and critical jobs
        // for every Organization matched by a single delete predicate.
        if (before.model === "organization" && before.rows.length > 1)
          await adapter.deleteMany(scoped);
        else await adapter.delete(scoped);
        facts.push(...deletedFacts(before));
      };
      const deleteMany: Adapter["deleteMany"] = async (input) => {
        if (!isLifecycleModel(input.model)) return adapter.deleteMany(input);
        if (!facts) return transaction((tx) => tx.deleteMany(input));
        const before = await snapshot(input.model, input.where);
        if (!before.rows.length) return 0;
        const count = await adapter.deleteMany({ ...input, where: byId(before.rows) });
        if (count) facts.push(...deletedFacts(before));
        return count;
      };
      const updateMany: Adapter["updateMany"] = async (input) => {
        if (!isLifecycleModel(input.model)) return adapter.updateMany(input);
        if (!facts) return transaction((tx) => tx.updateMany(input));
        const before = await snapshot(input.model, input.where);
        if (!before.rows.length) return 0;
        const count = await adapter.updateMany({ ...input, where: byId(before.rows) });
        if (count) facts.push(...(await updatedFacts(before)));
        return count;
      };
      return { ...adapter, create, update, updateMany, delete: remove, deleteMany, transaction };
    };
    return wrap(database);
  };
}
