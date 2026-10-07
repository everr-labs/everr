// @vitest-environment node
import { expect, it, vi } from "vitest";

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
