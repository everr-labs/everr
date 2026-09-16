import { Pool } from "pg";
import { pool } from "@/db/client";

// Lock holders call Better Auth and Drizzle through the application pool.
// A separate bounded pool prevents concurrent holders from exhausting the
// connections needed to finish their own work.
const checkoutLockPool = new Pool({
  ...pool.options,
  // pg deliberately makes password non-enumerable, so object spread drops it.
  password: pool.options.password,
  max: 2,
});

export function organizationCheckoutLockKey(ownerId: string, name: string) {
  return JSON.stringify(["pro-organization-checkout", ownerId, name]);
}

// Session locks allow the intent to be committed before contacting Polar.
// Do not queue waiters in the pool: the holder also needs database connections.
export async function withCheckoutLock<T>(
  key: string,
  run: () => Promise<T>,
): Promise<T> {
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
      releaseError = error instanceof Error ? error : new Error(String(error));
    } finally {
      client.release(releaseError);
    }
  }
}
