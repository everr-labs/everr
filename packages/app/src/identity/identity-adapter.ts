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
        if (!["user", "organization", "member"].includes(input.model))
          return adapter.create<T, R>(input);
        if (!facts) return transaction((tx) => tx.create<T, R>(input));
        if (input.model === "organization") {
          const created = await adapter.create<T, R & { id: string }>({
            ...input,
            select: undefined,
          });
          facts.push(organizationChanged("organization.created", created.id));
          if (!input.select?.length) return created;
          return (
            (await adapter.findOne<R>({
              model: input.model,
              where: [{ field: "id", value: created.id }],
              select: input.select,
            })) ?? created
          );
        }
        if (input.model === "member") {
          const created = await adapter.create<
            T,
            R & { id: string; organizationId: string; userId: string }
          >({ ...input, select: undefined });
          facts.push(membershipChanged("membership.added", created));
          if (!input.select?.length) return created;
          return (
            (await adapter.findOne<R>({
              model: input.model,
              where: [{ field: "id", value: created.id }],
              select: input.select,
            })) ?? created
          );
        }
        const result = await adapter.create<T, R>(input);
        // Read the inserted identity independently of Better Auth's selected
        // output. Email is the required unique user key in this feature.
        const created = await adapter.findOne<{ id: string; emailVerified: boolean }>({
          model: "user",
          where: [{ field: "email", value: String(input.data.email) }],
          select: ["id", "emailVerified"],
        });
        if (created) facts.push(userCreated(created.id, created.emailVerified));
        return result;
      };
      const snapshot = async (where: Parameters<Adapter["findMany"]>[0]["where"]) => {
        const rows = await adapter.findMany<{ id: string }>({
          model: "user",
          where,
          select: ["id"],
          limit: Number.MAX_SAFE_INTEGER,
        });
        if (!rows.length) return [];
        for (const { id } of [...rows].sort((a, b) => a.id.localeCompare(b.id)))
          await requests.lockUserLifecycle(id);
        // Serialize before/after capture so concurrent verification requests see
        // the persisted false-to-true transition exactly once.
        const locked = await executor
          .select()
          .from(user)
          .where(
            inArray(
              user.id,
              rows.map(({ id }) => id),
            ),
          )
          .orderBy(user.id)
          .for("update");
        const matching = await adapter.findMany<{ id: string }>({
          model: "user",
          where,
          select: ["id"],
          limit: Number.MAX_SAFE_INTEGER,
        });
        const ids = new Set(matching.map(({ id }) => id));
        return locked.filter(({ id }) => ids.has(id));
      };
      const organizationSnapshot = async (where: Parameters<Adapter["findMany"]>[0]["where"]) => {
        const rows = await adapter.findMany<{ id: string }>({
          model: "organization",
          where,
          select: ["id"],
          limit: Number.MAX_SAFE_INTEGER,
        });
        if (!rows.length) return [];
        const locked = await executor
          .select({ id: organization.id })
          .from(organization)
          .where(
            inArray(
              organization.id,
              rows.map(({ id }) => id),
            ),
          )
          .orderBy(organization.id)
          .for("update");
        // A concurrent writer can change the original predicate while this
        // transaction waits for row locks. Revalidate before mutating by ID.
        const matching = await adapter.findMany<{ id: string }>({
          model: "organization",
          where,
          select: ["id"],
          limit: Number.MAX_SAFE_INTEGER,
        });
        const ids = new Set(matching.map(({ id }) => id));
        return locked.filter(({ id }) => ids.has(id));
      };
      const membershipSnapshot = async (where: Parameters<Adapter["findMany"]>[0]["where"]) => {
        const rows = await adapter.findMany<{ id: string }>({
          model: "member",
          where,
          select: ["id"],
          limit: Number.MAX_SAFE_INTEGER,
        });
        if (!rows.length) return [];
        const locked = await executor
          .select({ id: member.id, organizationId: member.organizationId, userId: member.userId })
          .from(member)
          .where(
            inArray(
              member.id,
              rows.map(({ id }) => id),
            ),
          )
          .orderBy(member.id)
          .for("update");
        const matching = await adapter.findMany<{ id: string }>({
          model: "member",
          where,
          select: ["id"],
          limit: Number.MAX_SAFE_INTEGER,
        });
        const ids = new Set(matching.map(({ id }) => id));
        return locked.filter(({ id }) => ids.has(id));
      };
      const userUpdateFacts = async (before: Awaited<ReturnType<typeof snapshot>>) => {
        const after = await executor
          .select()
          .from(user)
          .where(
            inArray(
              user.id,
              before.map((row) => row.id),
            ),
          )
          .orderBy(user.id);
        const previous = new Map(before.map((row) => [row.id, row]));
        const updates: IdentityEvent[] = [];
        for (const row of after) {
          updates.push(userChanged("identity.user.updated", row.id));
          if (previous.get(row.id)?.emailVerified === false && row.emailVerified)
            updates.push(userChanged("identity.email.verified", row.id));
        }
        return updates;
      };
      const membershipUpdateFacts = async (
        before: Awaited<ReturnType<typeof membershipSnapshot>>,
      ) => {
        const after = await executor
          .select()
          .from(member)
          .where(
            inArray(
              member.id,
              before.map((row) => row.id),
            ),
          )
          .orderBy(member.id);
        const previous = new Map(before.map((row) => [row.id, row]));
        return after.map((row) =>
          membershipChanged("membership.updated", row, previous.get(row.id)),
        );
      };
      const update: Adapter["update"] = async <T>(
        input: Parameters<Adapter["update"]>[0],
      ): Promise<T | null> => {
        if (!["user", "organization", "member"].includes(input.model))
          return adapter.update<T>(input);
        if (!facts) return transaction((tx) => tx.update<T>(input));
        if (input.model === "organization") {
          const before = await organizationSnapshot(input.where);
          if (!before.length) return null;
          const result = await adapter.update<T>({
            ...input,
            where: [{ field: "id", operator: "in", value: before.map(({ id }) => id) }],
          });
          if (result)
            for (const row of before)
              facts.push(organizationChanged("organization.updated", row.id));
          return result;
        }
        if (input.model === "member") {
          const before = await membershipSnapshot(input.where);
          if (!before.length) return null;
          const result = await adapter.update<T>({
            ...input,
            where: [{ field: "id", operator: "in", value: before.map(({ id }) => id) }],
          });
          if (result) facts.push(...(await membershipUpdateFacts(before)));
          return result;
        }
        const before = await snapshot(input.where);
        if (!before.length) return null;
        const result = await adapter.update<T>({
          ...input,
          where: [{ field: "id", operator: "in", value: before.map((row) => row.id) }],
        });
        if (result) facts.push(...(await userUpdateFacts(before)));
        return result;
      };
      const remove: Adapter["delete"] = async (input) => {
        if (!["user", "organization", "member"].includes(input.model)) return adapter.delete(input);
        if (!facts) return transaction((tx) => tx.delete(input));
        if (input.model === "organization") {
          const before = await organizationSnapshot(input.where);
          if (!before.length) return;
          const scoped = {
            ...input,
            where: [{ field: "id", operator: "in" as const, value: before.map(({ id }) => id) }],
          };
          // Providers use their bulk path to retain cleanup and critical jobs
          // for every Organization matched by a single delete predicate.
          if (before.length > 1) await adapter.deleteMany(scoped);
          else await adapter.delete(scoped);
          for (const row of before) facts.push(organizationChanged("organization.deleted", row.id));
          return;
        }
        if (input.model === "member") {
          const before = await membershipSnapshot(input.where);
          if (!before.length) return;
          await adapter.delete({
            ...input,
            where: [{ field: "id", operator: "in", value: before.map(({ id }) => id) }],
          });
          for (const row of before) facts.push(membershipChanged("membership.removed", row));
          return;
        }
        const before = await snapshot(input.where);
        if (!before.length) return;
        await adapter.delete({
          ...input,
          where: [{ field: "id", operator: "in", value: before.map((row) => row.id) }],
        });
        for (const row of before) facts.push(userChanged("identity.user.deleted", row.id));
      };
      const deleteMany: Adapter["deleteMany"] = async (input) => {
        if (!["user", "organization", "member"].includes(input.model))
          return adapter.deleteMany(input);
        if (!facts) return transaction((tx) => tx.deleteMany(input));
        if (input.model === "user") {
          const before = await snapshot(input.where);
          if (!before.length) return 0;
          const count = await adapter.deleteMany({
            ...input,
            where: [{ field: "id", operator: "in", value: before.map((row) => row.id) }],
          });
          if (count)
            for (const row of before) facts.push(userChanged("identity.user.deleted", row.id));
          return count;
        }
        if (input.model === "organization") {
          const before = await organizationSnapshot(input.where);
          if (!before.length) return 0;
          const count = await adapter.deleteMany({
            ...input,
            where: [{ field: "id", operator: "in", value: before.map(({ id }) => id) }],
          });
          for (const row of before) facts.push(organizationChanged("organization.deleted", row.id));
          return count;
        }
        const before = await membershipSnapshot(input.where);
        if (!before.length) return 0;
        const count = await adapter.deleteMany({
          ...input,
          where: [{ field: "id", operator: "in", value: before.map(({ id }) => id) }],
        });
        for (const row of before) facts.push(membershipChanged("membership.removed", row));
        return count;
      };
      const updateMany: Adapter["updateMany"] = async (input) => {
        if (!["user", "organization", "member"].includes(input.model))
          return adapter.updateMany(input);
        if (!facts) return transaction((tx) => tx.updateMany(input));
        if (input.model === "user") {
          const before = await snapshot(input.where);
          if (!before.length) return 0;
          const count = await adapter.updateMany({
            ...input,
            where: [{ field: "id", operator: "in", value: before.map((row) => row.id) }],
          });
          if (count) facts.push(...(await userUpdateFacts(before)));
          return count;
        }
        if (input.model === "organization") {
          const before = await organizationSnapshot(input.where);
          if (!before.length) return 0;
          const count = await adapter.updateMany({
            ...input,
            where: [{ field: "id", operator: "in", value: before.map(({ id }) => id) }],
          });
          for (const row of before) facts.push(organizationChanged("organization.updated", row.id));
          return count;
        }
        const before = await membershipSnapshot(input.where);
        if (!before.length) return 0;
        const count = await adapter.updateMany({
          ...input,
          where: [{ field: "id", operator: "in", value: before.map(({ id }) => id) }],
        });
        if (count) facts.push(...(await membershipUpdateFacts(before)));
        return count;
      };
      return { ...adapter, create, update, updateMany, delete: remove, deleteMany, transaction };
    };
    return wrap(database);
  };
}
