import type { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq, inArray } from "drizzle-orm";
import type { IdentityProvider } from "#app/composition/identity-provider.ts";
import type { BusinessEvents } from "#app/composition/business-events.ts";
import { type Database, type DbExecutor, runInTransaction } from "#app/db/database.ts";
import { user } from "#app/db/schema/index.ts";
import { publishUserFact, userChanged, userCreated, type UserFact } from "./events";

type Factory = ReturnType<typeof drizzleAdapter>;
type Adapter = ReturnType<Factory>;

/**
 * User facts belong to the persistence commit, including Better Auth's nested
 * OAuth transactions. Its queued database after-hooks also run after rollback
 * in 1.6.33, so they cannot establish this boundary.
 */
export function userLifecycleAdapter(
  database: Database,
  factory: (executor: DbExecutor) => Factory,
  events: BusinessEvents<UserFact>,
  requests: Pick<IdentityProvider, "withIdentityRequest" | "lockUserLifecycle"> = {
    withIdentityRequest: (run) => run(),
    lockUserLifecycle: async () => {},
  },
): Factory {
  return (options) => {
    const wrap = (executor: DbExecutor, facts?: UserFact[]): Adapter => {
      const adapter = factory(executor)(options);
      const transaction: Adapter["transaction"] = async (run) => {
        if (facts) return runInTransaction(executor, (tx) => run(wrap(tx, facts)));
        return requests.withIdentityRequest(async () => {
          const committed: UserFact[] = [];
          const result = await runInTransaction(executor, (tx) => run(wrap(tx, committed)));
          for (const fact of committed) publishUserFact(events, fact);
          return result;
        });
      };
      const create: Adapter["create"] = async <T extends Record<string, unknown>, R = T>(input: {
        model: string;
        data: Omit<T, "id">;
        select?: string[];
        forceAllowId?: boolean;
      }): Promise<R> => {
        if (input.model !== "user") return adapter.create<T, R>(input);
        if (!facts) return transaction((tx) => tx.create<T, R>(input));
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
        return executor
          .select()
          .from(user)
          .where(
            inArray(
              user.id,
              rows.map(({ id }) => id),
            ),
          )
          .for("update");
      };
      const update: Adapter["update"] = async <T>(
        input: Parameters<Adapter["update"]>[0],
      ): Promise<T | null> => {
        if (input.model !== "user") return adapter.update<T>(input);
        if (!facts) return transaction((tx) => tx.update<T>(input));
        const [before] = await snapshot(input.where);
        const result = await adapter.update<T>(input);
        if (before && result) {
          const [after] = await executor.select().from(user).where(eq(user.id, before.id));
          if (after) {
            facts.push(userChanged("identity.user.updated", before.id));
            if (!before.emailVerified && after.emailVerified)
              facts.push(userChanged("identity.email.verified", before.id));
          }
        }
        return result;
      };
      const remove: Adapter["delete"] = async (input) => {
        if (input.model !== "user") return adapter.delete(input);
        if (!facts) return transaction((tx) => tx.delete(input));
        const [before] = await snapshot(input.where);
        await adapter.delete(input);
        if (before) facts.push(userChanged("identity.user.deleted", before.id));
      };
      return { ...adapter, create, update, delete: remove, transaction };
    };
    return wrap(database);
  };
}
