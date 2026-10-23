// @vitest-environment node
import { expect, it, vi } from "vite-plus/test";

async function freshShutdown() {
  vi.resetModules();
  delete (globalThis as { __everrShutdown?: unknown }).__everrShutdown;
  return import("./shutdown");
}
it("waits for worker shutdown before flushing telemetry and is idempotent", async () => {
  const { registerShutdownHook, shutdownRuntime } = await freshShutdown();
  const order: string[] = [];
  let release!: () => void;
  registerShutdownHook("jobs", "workers", async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    order.push("workers");
  });
  registerShutdownHook("sdk", "telemetry", async () => {
    order.push("telemetry");
  });
  const first = shutdownRuntime();
  expect(shutdownRuntime()).toBe(first);
  expect(order).toEqual([]);
  await Promise.resolve();
  release();
  await first;
  expect(order).toEqual(["workers", "telemetry"]);
});
it("still flushes telemetry when a worker cannot stop", async () => {
  const { registerShutdownHook, shutdownRuntime } = await freshShutdown();
  const flush = vi.fn().mockResolvedValue(undefined);
  registerShutdownHook("jobs", "workers", async () => {
    throw new Error("Shutdown failed");
  });
  registerShutdownHook("sdk", "telemetry", flush);
  await expect(shutdownRuntime()).rejects.toThrow("Runtime shutdown failed");
  expect(flush).toHaveBeenCalledOnce();
});

it("drains publications before stopping workers and flushing telemetry", async () => {
  const { registerShutdownHook, shutdownRuntime } = await freshShutdown();
  const order: string[] = [];
  let release!: () => void;
  registerShutdownHook("events", "publications", async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    order.push("publications");
  });
  registerShutdownHook("jobs", "workers", async () => {
    order.push("workers");
  });
  registerShutdownHook("sdk", "telemetry", async () => {
    order.push("telemetry");
  });
  const stopped = shutdownRuntime();
  expect(order).toEqual([]);
  release();
  await stopped;
  expect(order).toEqual(["publications", "workers", "telemetry"]);
});

it("drains observations before closing domain publication admission", async () => {
  const { registerShutdownHook, shutdownRuntime } = await freshShutdown();
  const order: string[] = [];
  let release!: () => void;
  registerShutdownHook("consultations", "observations", async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    order.push("marker-committed-and-published");
  });
  registerShutdownHook("events", "publications", async () => {
    order.push("publication-closed");
  });
  const stopped = shutdownRuntime();
  expect(order).toEqual([]);
  release();
  await stopped;
  expect(order).toEqual(["marker-committed-and-published", "publication-closed"]);
});
