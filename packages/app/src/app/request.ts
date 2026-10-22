import { AsyncLocalStorage } from "node:async_hooks";
import { APIError } from "better-auth/api";
import type { Pool, PoolClient } from "pg";

export function createWorkspaceIdentityRequests(lockPool: Pick<Pool, "connect">) {
  const requests = new AsyncLocalStorage<{ client?: PoolClient }>();

  async function withIdentityRequest<T>(run: () => Promise<T>): Promise<T> {
    if (requests.getStore()) return run();
    const scope: { client?: PoolClient } = {};
    return requests.run(scope, async () => {
      try {
        return await run();
      } finally {
        if (scope.client) {
          let releaseError: Error | undefined;
          try {
            await scope.client.query("SELECT pg_advisory_unlock(1936028277, 2)");
          } catch (error) {
            releaseError = error instanceof Error ? error : new Error(String(error));
          }
          scope.client.release(releaseError);
        }
      }
    });
  }

  // Hold the lock through Better Auth's mutation, not just its before-hook. This
  // prevents concurrent account deletion, demotion and leave from removing all owners.
  async function lockWorkspaceMembership() {
    const scope = requests.getStore();
    if (!scope)
      throw new APIError("FORBIDDEN", {
        message: "Membership changes require an identity request.",
      });
    if (scope.client) return;
    const client = await lockPool.connect();
    try {
      const result = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(1936028277, 2) AS locked",
      );
      if (!result.rows[0]?.locked)
        throw new APIError("CONFLICT", {
          message: "Workspace membership is being updated. Please try again.",
        });
      scope.client = client;
    } catch (error) {
      client.release(
        error instanceof APIError
          ? undefined
          : error instanceof Error
            ? error
            : new Error(String(error)),
      );
      throw error;
    }
  }

  return { withIdentityRequest, lockWorkspaceMembership };
}
