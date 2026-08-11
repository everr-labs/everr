// fallow-ignore-file unused-file
// Not imported yet: the smoke test that mocks @/db/client with this module
// lands in a later task, in the same pipeline-test-harness plan.
import { PgTransaction } from "drizzle-orm/pg-core";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type * as schema from "@/db/schema";

type TestDb = PgliteDatabase<typeof schema>;

let current: TestDb | undefined;

export function setTestDatabase(db: TestDb | undefined): void {
  current = db;
}

// The pipeline imports `db` while the module graph loads, which is before any
// beforeAll can build a database. A proxy defers every property read to the
// moment the query runs, by which time the hook has set one.
export const testDb = new Proxy({} as TestDb, {
  get(_target, property) {
    if (!current) {
      throw new Error(
        "test database not set: call setTestDatabase in beforeAll",
      );
    }
    // The receiver defaults to the target, which is the real database. Passing
    // the proxy instead would run any accessor drizzle adds later with `this`
    // bound to the proxy, and the wrong value would read as a pipeline bug.
    const value = Reflect.get(current, property);
    return typeof value === "function" ? value.bind(current) : value;
  },
}) as TestDb;

// Copied from @/db/client rather than imported: importing it would construct
// the real connection pool, which is the thing the mock exists to avoid.
export function runInTransaction<T>(
  executor: unknown,
  fn: (tx: never) => Promise<T>,
): Promise<T> {
  return executor instanceof PgTransaction
    ? fn(executor as never)
    : (executor as TestDb).transaction(fn as never);
}
