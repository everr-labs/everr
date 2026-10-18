// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("#app/db/client.ts", () => ({
  pool: { options: { host: "localhost", password: "test" } },
}));
vi.mock("pg", () => ({
  Pool: class {
    connect() {
      return Promise.resolve(mocks);
    }
  },
}));

import {
  lockWorkspaceMembership,
  withIdentityRequest,
} from "#app/app/request.ts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [{ locked: true }] });
});
it("holds one lock through the whole identity mutation and releases it on failure", async () => {
  await expect(
    withIdentityRequest(async () => {
      await lockWorkspaceMembership();
      await withIdentityRequest(async () => {
        await lockWorkspaceMembership();
      });
      expect(mocks.query).toHaveBeenCalledTimes(1);
      expect(mocks.release).not.toHaveBeenCalled();
      throw new Error("mutation failed");
    }),
  ).rejects.toThrow("mutation failed");
  expect(mocks.query).toHaveBeenLastCalledWith(
    "SELECT pg_advisory_unlock(1936028277, 2)",
  );
  expect(mocks.release).toHaveBeenCalledOnce();
});
it("rejects a concurrent mutation without leaving a connection held", async () => {
  mocks.query.mockResolvedValueOnce({ rows: [{ locked: false }] });
  await expect(withIdentityRequest(lockWorkspaceMembership)).rejects.toThrow(
    "Please try again",
  );
  expect(mocks.release).toHaveBeenCalledOnce();
  expect(mocks.query).toHaveBeenCalledTimes(1);
});
it("fails closed outside an identity request", async () => {
  await expect(lockWorkspaceMembership()).rejects.toThrow("identity request");
  expect(mocks.query).not.toHaveBeenCalled();
});
