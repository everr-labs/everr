// @vitest-environment node

import { createLockPool } from "@everr/app/db/database";

import { Pool, type PoolClient } from "pg";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { createBillingRequestLocks } from "./request-locks";

const mocks = { query: vi.fn(), release: vi.fn() };
let locks: ReturnType<typeof createBillingRequestLocks>;
const withBillingRequest = <T>(run: () => Promise<T>) => locks.withBillingRequest(run);
const withCheckoutLock = <T>(key: string, run: () => Promise<T>) =>
  locks.withCheckoutLock(key, run);

beforeEach(() => {
  vi.resetAllMocks();
  locks = createBillingRequestLocks({
    connect: async () => mocks as unknown as PoolClient,
  });
  mocks.query.mockResolvedValue({ rows: [{ locked: true }] });
});
it("releases its session lock after a failed operation", async () => {
  await expect(
    withCheckoutLock("intent", async () => {
      throw new Error("failed");
    }),
  ).rejects.toThrow("failed");
  expect(mocks.query).toHaveBeenLastCalledWith(
    "select pg_advisory_unlock(hashtextextended($1, 0))",
    ["intent"],
  );
  expect(mocks.release).toHaveBeenCalledWith(undefined);
});
it("rejects concurrent processing without retaining a pool connection", async () => {
  mocks.query.mockResolvedValueOnce({ rows: [{ locked: false }] });
  const run = vi.fn();
  await expect(withCheckoutLock("intent", run)).rejects.toThrow("Please try again");
  expect(run).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.release).toHaveBeenCalledWith(undefined);
});
it("discards a connection if unlock fails", async () => {
  const error = new Error("connection lost");
  mocks.query.mockResolvedValueOnce({ rows: [{ locked: true }] }).mockRejectedValueOnce(error);
  await expect(withCheckoutLock("intent", async () => "ok")).resolves.toBe("ok");
  expect(mocks.release).toHaveBeenCalledWith(error);
});

it("preserves authentication when deriving the checkout pool from a real pg pool", async () => {
  const base = new Pool({
    password: "regression-test-password",
    connectionTimeoutMillis: 10000,
  });
  const dedicated = createLockPool(base.options);
  try {
    expect(dedicated.options.password).toBe("regression-test-password");
    expect(dedicated.options.connectionTimeoutMillis).toBe(10000);
    expect(dedicated.options.max).toBe(2);
  } finally {
    await Promise.all([base.end(), dedicated.end()]);
  }
});

it("retains and reuses user and organization locks until the whole request completes", async () => {
  await withBillingRequest(async () => {
    await locks.lockUserLifecycle("owner");
    await locks.lockUserLifecycle("owner");
    await locks.lockAccountDeletion(["org", "other", "org"]);
    await withCheckoutLock("billing:org", async () => {
      await withCheckoutLock("billing:org", async () => "nested");
    });
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.slice(0, 3).map(([, keys]) => keys)).toEqual([
      ["identity:user:owner"],
      ["billing:org"],
      ["billing:other"],
    ]);
    expect(mocks.release).not.toHaveBeenCalled();
  });
  expect(mocks.query).toHaveBeenCalledTimes(6);
  expect(mocks.release).toHaveBeenCalledTimes(1);
});

it("keeps independent request-lock instances isolated", async () => {
  const other = createBillingRequestLocks({
    connect: async () => mocks as unknown as PoolClient,
  });
  await withBillingRequest(async () => {
    await withCheckoutLock("billing:org", async () => {});
    await other.withBillingRequest(() => other.withCheckoutLock("billing:org", async () => {}));
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
  expect(mocks.release).toHaveBeenCalledTimes(2);
});
