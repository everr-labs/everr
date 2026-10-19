// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generalStart: vi.fn(),
  generalStop: vi.fn(),
  appStart: vi.fn(),
  appStop: vi.fn(),
  registerShutdownHook: vi.fn(),
}));
vi.mock("@composition/server", () => ({
  server: { startAppWorkers: mocks.appStart },
}));
vi.mock("./managed-worker", () => ({
  managedWorker: () => ({ start: mocks.generalStart, stop: mocks.generalStop }),
}));
vi.mock("#app/db/client.ts", () => ({ pool: {} }));
vi.mock("#app/integrations/github/registration.ts", () => ({
  githubTasks: vi.fn(),
}));
vi.mock("#app/server/alerting/runtime.ts", () => ({
  alertCronItems: [],
  alertTaskList: {},
}));
vi.mock("#app/server/previews/00-runtime.ts", () => ({
  previewsCronItems: [],
  previewsTaskList: {},
}));
vi.mock("#app/server/shutdown.ts", () => ({
  registerShutdownHook: mocks.registerShutdownHook,
}));

import { startWorkerRuntime } from "./runtime";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.generalStart.mockResolvedValue(undefined);
  mocks.generalStop.mockResolvedValue(undefined);
  mocks.appStart.mockResolvedValue({ stop: mocks.appStop });
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

it.each([
  "app",
  "general",
])("cleans up a partial startup when %s startup fails", async (group) => {
  const error = new Error(`${group} startup failed`);
  (group === "app" ? mocks.appStart : mocks.generalStart).mockRejectedValueOnce(
    error,
  );
  await expect(startWorkerRuntime()).rejects.toBe(error);
  expect(mocks.generalStop).toHaveBeenCalledOnce();
  expect(mocks.appStop).toHaveBeenCalledTimes(group === "app" ? 0 : 1);
});

it("waits for pending application startup during shutdown", async () => {
  let finishStart!: (handle: { stop: () => Promise<void> }) => void;
  mocks.appStart.mockReturnValueOnce(
    new Promise((resolve) => {
      finishStart = resolve;
    }),
  );
  const starting = startWorkerRuntime();
  const shutdown = mocks.registerShutdownHook.mock.calls.at(-1)?.[2];
  const stopped = vi.fn();
  const stopping = shutdown().then(stopped);
  await Promise.resolve();
  expect(stopped).not.toHaveBeenCalled();
  finishStart({ stop: mocks.appStop });
  await starting;
  await stopping;
  expect(mocks.appStop).toHaveBeenCalledOnce();
});

it("drains both groups even when one shutdown fails", async () => {
  const error = new Error("app shutdown failed");
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
  await Promise.resolve();
  expect(rejected).not.toHaveBeenCalled();
  finishStop();
  await stopping;
  expect(rejected).toHaveBeenCalledWith(
    expect.objectContaining({ errors: [error] }),
  );
  expect(mocks.generalStop).toHaveBeenCalledOnce();
  expect(mocks.appStop).toHaveBeenCalledOnce();
});

it("retains the startup failure if rollback also fails", async () => {
  const startupError = new Error("app startup failed");
  const cleanupError = new Error("general shutdown failed");
  mocks.appStart.mockRejectedValueOnce(startupError);
  mocks.generalStop.mockRejectedValueOnce(cleanupError);
  await expect(startWorkerRuntime()).rejects.toMatchObject({
    errors: [startupError, expect.objectContaining({ errors: [cleanupError] })],
  });
});
