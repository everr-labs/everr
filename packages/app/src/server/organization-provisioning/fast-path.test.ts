// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/db/client", () => ({
  db: { select: () => ({ from: () => ({ where: mocks.read }) }) },
}));
vi.mock("@/telemetry/logger", () => ({
  serverLogger: { info: mocks.info, error: mocks.error },
  exceptionAttributes: (error: Error) => ({
    "exception.message": error.message,
  }),
}));

import { waitForOrganizationProvisioning } from "./fast-path";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.read.mockResolvedValue([{ ready: false }]);
});
afterEach(() => {
  vi.useRealTimers();
});
it("returns immediately when the committed job has already finished", async () => {
  mocks.read.mockResolvedValue([{ ready: true }]);
  await expect(waitForOrganizationProvisioning("org")).resolves.toBe(true);
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("returns ready when provisioning finishes during the signup wait", async () => {
  mocks.read
    .mockResolvedValueOnce([{ ready: false }])
    .mockResolvedValueOnce([{ ready: true }]);
  const result = waitForOrganizationProvisioning("org");
  await vi.advanceTimersByTimeAsync(100);
  await expect(result).resolves.toBe(true);
  expect(mocks.info).toHaveBeenCalledWith(
    "clickhouse.organization.fast_path.ready",
    { "everr.organization.id": "org" },
  );
});
it("returns pending within five seconds and stops polling during a prolonged stall", async () => {
  const result = waitForOrganizationProvisioning("org");
  await vi.advanceTimersByTimeAsync(5000);
  await expect(result).resolves.toBe(false);
  const queries = mocks.read.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.read).toHaveBeenCalledTimes(queries);
  expect(mocks.error).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("also bounds a hanging Postgres lookup and ignores its late completion", async () => {
  let finish!: (value: { ready: boolean }[]) => void;
  mocks.read.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const result = waitForOrganizationProvisioning("org");
  await vi.advanceTimersByTimeAsync(5000);
  await expect(result).resolves.toBe(false);
  finish([{ ready: false }]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("logs a failed readiness lookup without failing signup", async () => {
  mocks.read.mockRejectedValue(new Error("Postgres unavailable"));
  await expect(waitForOrganizationProvisioning("org")).resolves.toBe(false);
  expect(mocks.error).toHaveBeenCalledWith(
    "clickhouse.organization.fast_path.failed",
    expect.objectContaining({
      "exception.message": "Postgres unavailable",
      "everr.organization.id": "org",
    }),
  );
});
it("stops immediately when the organization was deleted", async () => {
  mocks.read.mockResolvedValue([]);
  await expect(waitForOrganizationProvisioning("org")).resolves.toBe(false);
  expect(mocks.read).toHaveBeenCalledOnce();
});
