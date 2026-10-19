import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";

export function createBillingRequestLocks(
  checkoutLockPool: Pick<Pool, "connect">,
) {
  const requestLocks = new AsyncLocalStorage<{
    client?: PoolClient;
    keys: Set<string>;
  }>();

  // Retain all organization locks until Better Auth has finished its local writes
  // and hooks. One connection handles multiple orgs during user/account changes.
  async function withBillingRequest<T>(run: () => Promise<T>): Promise<T> {
    if (requestLocks.getStore()) return run();
    const scope: { client?: PoolClient; keys: Set<string> } = {
      keys: new Set(),
    };
    return requestLocks.run(scope, async () => {
      try {
        return await run();
      } finally {
        if (scope.client) {
          let releaseError: Error | undefined;
          try {
            for (const key of scope.keys)
              await scope.client.query(
                "select pg_advisory_unlock(hashtextextended($1, 0))",
                [key],
              );
          } catch (error) {
            releaseError =
              error instanceof Error ? error : new Error(String(error));
          }
          scope.client.release(releaseError);
        }
      }
    });
  }

  // Session locks allow the intent to be committed before contacting Polar.
  // Do not queue waiters in the pool: the holder also needs database connections.
  async function withCheckoutLock<T>(
    key: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const scope = requestLocks.getStore();
    if (scope) {
      if (!scope.keys.has(key)) {
        scope.client ??= await checkoutLockPool.connect();
        const result = await scope.client.query<{ locked: boolean }>(
          "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked",
          [key],
        );
        if (!result.rows[0]?.locked)
          throw new Error("Billing is being processed. Please try again.");
        scope.keys.add(key);
      }
      return run();
    }
    const client = await checkoutLockPool.connect();
    let locked = false;
    let releaseError: Error | undefined;
    try {
      const result = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked",
        [key],
      );
      locked = result.rows[0]?.locked === true;
      if (!locked)
        throw new Error("Checkout is being processed. Please try again.");
      return await run();
    } finally {
      try {
        if (locked)
          await client.query(
            "select pg_advisory_unlock(hashtextextended($1, 0))",
            [key],
          );
      } catch (error) {
        // Discard a connection whose lock could not be released.
        releaseError =
          error instanceof Error ? error : new Error(String(error));
      } finally {
        client.release(releaseError);
      }
    }
  }

  async function lockAccountDeletion(organizationIds: readonly string[]) {
    if (!requestLocks.getStore())
      throw new Error("Account deletion requires an identity request.");
    for (const organizationId of [...organizationIds].sort())
      await withCheckoutLock(`billing:${organizationId}`, async () => {});
  }

  async function lockUserLifecycle(userId: string) {
    if (!requestLocks.getStore())
      throw new Error("User lifecycle changes require an identity request.");
    await withCheckoutLock(`identity:user:${userId}`, async () => {});
  }

  return {
    withBillingRequest,
    withCheckoutLock,
    lockAccountDeletion,
    lockUserLifecycle,
  };
}
