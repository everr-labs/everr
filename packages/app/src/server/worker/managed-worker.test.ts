// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { managedWorker } from "./managed-worker";

const pending = () => new Promise<void>(() => {});
afterEach(() => vi.useRealTimers());

it("retries a failed startup and does not cache the rejected attempt", async () => {
  vi.useFakeTimers();
  const stop = vi.fn().mockResolvedValue(undefined);
  const start = vi
    .fn()
    .mockRejectedValueOnce(new Error("Transient failure"))
    .mockResolvedValue({ promise: pending(), stop });
  const runtime = managedWorker({
    name: "startup-retry-test",
    start,
    hot: undefined,
    retryDelayMs: 30,
  });
  await runtime.start();
  await vi.advanceTimersByTimeAsync(30);
  expect(start).toHaveBeenCalledTimes(2);
  await runtime.stop();
  expect(stop).toHaveBeenCalledOnce();
});

it("restarts a failed running worker and releases its resources", async () => {
  vi.useFakeTimers();
  let reject!: (error: Error) => void;
  const crashed = new Promise<void>((_, fail) => {
    reject = fail;
  });
  const stop = vi.fn().mockResolvedValue(undefined);
  const start = vi
    .fn()
    .mockResolvedValueOnce({ promise: crashed, stop })
    .mockResolvedValue({ promise: pending(), stop });
  const runtime = managedWorker({
    name: "runtime-retry-test",
    start,
    hot: undefined,
    retryDelayMs: 30,
  });
  await runtime.start();
  reject(new Error("Worker crashed"));
  await vi.advanceTimersByTimeAsync(30);
  expect(start).toHaveBeenCalledTimes(2);
  expect(stop).toHaveBeenCalledOnce();
  await runtime.stop();
  expect(stop).toHaveBeenCalledTimes(2);
});

it("shutdown cancels startup retry waits and prevents new starts", async () => {
  vi.useFakeTimers();
  const start = vi.fn().mockRejectedValue(new Error("Offline"));
  const runtime = managedWorker({
    name: "retry-shutdown-test",
    start,
    hot: undefined,
  });
  await runtime.start();
  await runtime.stop();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(start).toHaveBeenCalledOnce();
});
