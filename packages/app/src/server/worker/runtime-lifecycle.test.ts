// @vitest-environment node
import { beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  generalStart: vi.fn(),
  generalStop: vi.fn(),
  register: vi.fn(),
  appStart: vi.fn(),
  appStop: vi.fn(),
  registerShutdownHook: vi.fn(),
}));
vi.mock("@composition/runtime", () => ({
  runtime: { registerWorkers: mocks.register },
}));
vi.mock("./product-worker", () => ({
  productWorker: { start: mocks.generalStart, stop: mocks.generalStop },
}));
vi.mock("#app/server/shutdown.ts", () => ({
  registerShutdownHook: mocks.registerShutdownHook,
}));

import { startWorkerRuntime } from "./runtime";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.generalStart.mockResolvedValue(undefined);
  mocks.generalStop.mockResolvedValue(undefined);
  mocks.register.mockResolvedValue([{ start: mocks.appStart, stop: mocks.appStop }]);
  mocks.appStart.mockResolvedValue(undefined);
  mocks.appStop.mockResolvedValue(undefined);
});

it("shares one shutdown between the caller and process hook", async () => {
  const runtime = await startWorkerRuntime();
  const shutdown = mocks.registerShutdownHook.mock.calls.at(-1)?.[2];
  expect(shutdown).toEqual(expect.any(Function));
  await Promise.all([runtime.stop(), shutdown()]);
  expect(mocks.generalStop).toHaveBeenCalledOnce();
  expect(mocks.appStop).toHaveBeenCalledOnce();
});

it("cleans up registered workers including one whose startup fails", async () => {
  const error = new Error("app startup failed");
  const sibling = { start: vi.fn(), stop: vi.fn() };
  mocks.register.mockResolvedValueOnce([{ start: mocks.appStart, stop: mocks.appStop }, sibling]);
  mocks.appStart.mockRejectedValueOnce(error);
  await expect(startWorkerRuntime()).rejects.toMatchObject({ errors: [error] });
  expect(mocks.generalStop).toHaveBeenCalledOnce();
  expect(mocks.appStop).toHaveBeenCalledOnce();
  expect(sibling.start).toHaveBeenCalledOnce();
  expect(sibling.stop).toHaveBeenCalledOnce();
});

it("cleans up product workers when registration fails", async () => {
  const error = new Error("registration failed");
  mocks.register.mockRejectedValueOnce(error);
  await expect(startWorkerRuntime()).rejects.toBe(error);
  expect(mocks.generalStop).toHaveBeenCalledOnce();
  expect(mocks.appStart).not.toHaveBeenCalled();
});

it("cleans up application workers when product startup fails", async () => {
  const error = new Error("product startup failed");
  mocks.generalStart.mockRejectedValueOnce(error);
  await expect(startWorkerRuntime()).rejects.toMatchObject({ errors: [error] });
  expect(mocks.generalStop).toHaveBeenCalledOnce();
  expect(mocks.appStop).toHaveBeenCalledOnce();
});

it("waits for pending registration and startup during shutdown", async () => {
  let finishRegistration!: (
    workers: { start: typeof mocks.appStart; stop: typeof mocks.appStop }[],
  ) => void;
  let finishStart!: () => void;
  mocks.register.mockReturnValueOnce(
    new Promise((resolve) => {
      finishRegistration = resolve;
    }),
  );
  mocks.appStart.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishStart = resolve;
    }),
  );
  const starting = startWorkerRuntime();
  const shutdown = mocks.registerShutdownHook.mock.calls.at(-1)?.[2];
  const stopped = vi.fn();
  const stopping = shutdown().then(stopped);
  await vi.waitFor(() => expect(mocks.register).toHaveBeenCalledOnce());
  expect(stopped).not.toHaveBeenCalled();
  finishRegistration([{ start: mocks.appStart, stop: mocks.appStop }]);
  await vi.waitFor(() => expect(mocks.appStart).toHaveBeenCalledOnce());
  expect(mocks.appStop).not.toHaveBeenCalled();
  finishStart();
  await starting;
  await stopping;
  expect(mocks.appStop).toHaveBeenCalledOnce();
});

it("drains every worker even when one shutdown fails", async () => {
  const error = new Error("app shutdown failed");
  const sibling = { start: vi.fn(), stop: vi.fn() };
  mocks.register.mockResolvedValueOnce([{ start: mocks.appStart, stop: mocks.appStop }, sibling]);
  mocks.appStop.mockRejectedValueOnce(error);
  let finishStop!: () => void;
  mocks.generalStop.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishStop = resolve;
    }),
  );
  const runtime = await startWorkerRuntime();
  const rejected = vi.fn();
  const stopping = runtime.stop().catch(rejected);
  await vi.waitFor(() => expect(sibling.stop).toHaveBeenCalledOnce());
  expect(rejected).not.toHaveBeenCalled();
  finishStop();
  await stopping;
  expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ errors: [error] }));
  expect(mocks.generalStop).toHaveBeenCalledOnce();
  expect(mocks.appStop).toHaveBeenCalledOnce();
});

it("retains the startup failure if rollback also fails", async () => {
  const startupError = new Error("registration failed");
  const cleanupError = new Error("general shutdown failed");
  mocks.register.mockRejectedValueOnce(startupError);
  mocks.generalStop.mockRejectedValueOnce(cleanupError);
  await expect(startWorkerRuntime()).rejects.toMatchObject({
    errors: [startupError, expect.objectContaining({ errors: [cleanupError] })],
  });
});
