// @vitest-environment node
import { afterEach, expect, it, vi } from "vite-plus/test";
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

it("restarts a crashed worker even if its cleanup fails", async () => {
  vi.useFakeTimers();
  let rejectWorker!: (error: Error) => void;
  const crashed = new Promise<void>((_resolve, reject) => {
    rejectWorker = reject;
  });
  const stop = vi
    .fn()
    .mockRejectedValueOnce(new Error("Cleanup failed"))
    .mockResolvedValue(undefined);
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
  rejectWorker(new Error("Worker crashed"));
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

it("waits for cleanup in every concurrent shutdown call", async () => {
  let releaseStop!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseStop = resolve;
  });
  const stop = vi.fn(async () => {
    await gate;
  });
  const start = vi.fn(async () => ({ promise: pending(), stop }));
  const worker = managedWorker({ name: "concurrent-shutdown-test", start, hot: undefined });
  await worker.start();
  const first = worker.stop();
  const second = worker.stop();
  const settled = vi.fn();
  void second.then(settled);
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
  const resolvedBeforeDrain = settled.mock.calls.length;
  releaseStop();
  await Promise.all([first, second]);
  expect(resolvedBeforeDrain).toBe(0);
  expect(start).toHaveBeenCalledOnce();
});

it("drains a worker that finishes connecting after shutdown starts", async () => {
  let finishStart!: (handle: { promise: Promise<void>; stop(): Promise<void> }) => void;
  const connecting = new Promise<{ promise: Promise<void>; stop(): Promise<void> }>((resolve) => {
    finishStart = resolve;
  });
  const start = vi.fn(() => connecting);
  const worker = managedWorker({ name: "shutdown-while-connecting-test", hot: undefined, start });
  await worker.start();
  const settled = vi.fn();
  const stopping = worker.stop().then(settled);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(settled).not.toHaveBeenCalled();
  const stop = vi.fn().mockResolvedValue(undefined);
  finishStart({ promise: Promise.reject(new Error("Connection failed during shutdown")), stop });
  await stopping;
  expect(stop).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledOnce();
});
