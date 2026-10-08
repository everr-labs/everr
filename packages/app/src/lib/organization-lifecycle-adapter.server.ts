import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { z } from "zod";
import { parseOrganizationMetadata } from "@/common/organization-provisioning";
import {
  type Database,
  type DbExecutor,
  db,
  runInTransaction,
} from "@/db/client";
import { deletePostgresOrganizationData } from "@/lib/organization-data-cleanup.server";
import { preserveOrganizationProvisioningStatus } from "@/lib/organization-provisioning-metadata.server";
import {
  enqueueOrganizationDeprovisioning,
  enqueueOrganizationProvisioning,
} from "@/server/organization-provisioning/jobs";

// Keep access-entity work in the same commit as the organization mutation.
// Better Auth's after-hooks cannot provide that guarantee after process death.
export function organizationLifecycleAdapter(database: Database = db) {
  return (options: Parameters<ReturnType<typeof drizzleAdapter>>[0]) => {
    const factory = (executor: DbExecutor) =>
      drizzleAdapter(executor, { provider: "pg" })(options);
    const wrap = (executor: DbExecutor): ReturnType<typeof factory> => {
      const adapter = factory(executor);
      const create: typeof adapter.create = async <
        T extends Record<string, unknown>,
        R = T,
      >(input: {
        model: string;
        data: Omit<T, "id">;
        select?: string[];
        forceAllowId?: boolean;
      }): Promise<R> => {
        if (input.model !== "organization") return adapter.create<T, R>(input);
        return runInTransaction(executor, async (tx) => {
          const created = await factory(tx).create<T, R>({
            ...input,
            data: {
              ...input.data,
              metadata: JSON.stringify({
                ...parseOrganizationMetadata(input.data.metadata),
                clickhouseReady: false,
              }),
            },
          });
          const { id } = z.object({ id: z.string() }).parse(created);
          await enqueueOrganizationProvisioning(id, tx);
          return created;
        });
      };
      const update: typeof adapter.update = (input) =>
        adapter.update({
          ...input,
          update:
            input.model === "organization"
              ? preserveOrganizationProvisioningStatus(input.update)
              : input.update,
        });
      const updateMany: typeof adapter.updateMany = (input) =>
        adapter.updateMany({
          ...input,
          update:
            input.model === "organization"
              ? preserveOrganizationProvisioningStatus(input.update)
              : input.update,
        });
      const remove: typeof adapter.delete = async (input) => {
        if (input.model !== "organization") return adapter.delete(input);
        await runInTransaction(executor, async (tx) => {
          const scoped = factory(tx);
          const org = await scoped.findOne<{ id: string }>({
            model: "organization",
            where: input.where,
            select: ["id"],
          });
          if (!org) return;
          await deletePostgresOrganizationData(org.id, tx);
          await scoped.delete(input);
          await enqueueOrganizationDeprovisioning(org.id, tx);
        });
      };
      const deleteMany: typeof adapter.deleteMany = async (input) => {
        if (input.model !== "organization") return adapter.deleteMany(input);
        return runInTransaction(executor, async (tx) => {
          const scoped = factory(tx);
          const organizations = await scoped.findMany<{ id: string }>({
            model: "organization",
            where: input.where,
            select: ["id"],
            limit: Number.MAX_SAFE_INTEGER,
          });
          for (const org of organizations)
            await deletePostgresOrganizationData(org.id, tx);
          const count = await scoped.deleteMany(input);
          for (const org of organizations)
            await enqueueOrganizationDeprovisioning(org.id, tx);
          return count;
        });
      };
      // Better Auth routes use this callback adapter for mutations. Preserve the
      // lifecycle wrapper inside transactions, rather than returning raw Drizzle.
      const transaction: typeof adapter.transaction = (run) =>
        runInTransaction(executor, (tx) => run(wrap(tx)));
      return {
        ...adapter,
        create,
        update,
        updateMany,
        delete: remove,
        deleteMany,
        transaction,
      };
    };
    return wrap(database);
  };
}
