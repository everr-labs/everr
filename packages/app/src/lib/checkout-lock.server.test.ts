// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  poolOptions: {} as Record<string, unknown>,
}));
vi.mock("@/db/client", async () => {
  const { Pool } = await vi.importActual<typeof import("pg")>("pg");
  // Use the real driver's option descriptors, including its hidden password.
  return {
    pool: new Pool({
      password: "regression-test-password",
      host: "localhost",
      connectionTimeoutMillis: 10000,
    }),
  };
});
vi.mock("pg", () => ({
  Pool: class {
    constructor(options: Record<string, unknown>) {
      mocks.poolOptions = options;
    }
    connect() {
      return Promise.resolve(mocks);
    }
  },
}));

import { withCheckoutLock } from "./checkout-lock.server";

beforeEach(() => {
  vi.resetAllMocks();
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
  await expect(withCheckoutLock("intent", run)).rejects.toThrow(
    "Please try again",
  );
  expect(run).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.release).toHaveBeenCalledWith(undefined);
});
it("discards a connection if unlock fails", async () => {
  const error = new Error("connection lost");
  mocks.query
    .mockResolvedValueOnce({ rows: [{ locked: true }] })
    .mockRejectedValueOnce(error);
  await expect(withCheckoutLock("intent", async () => "ok")).resolves.toBe(
    "ok",
  );
  expect(mocks.release).toHaveBeenCalledWith(error);
});

it("preserves authentication when deriving the checkout pool from a real pg pool", () => {
  expect(mocks.poolOptions.password).toBe("regression-test-password");
  expect(mocks.poolOptions.connectionTimeoutMillis).toBe(10000);
  expect(mocks.poolOptions.max).toBe(2);
});
