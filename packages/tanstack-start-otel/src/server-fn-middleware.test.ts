import { describe, expect, it, vi } from "vitest";

const middlewareMocks = vi.hoisted(() => ({
  createMiddleware: vi.fn(() => ({
    server: vi.fn((serverFn: unknown) => ({ runServer: serverFn })),
  })),
  getRequest: vi.fn(
    () => new Request("http://localhost/_serverFn/c4d3d0c28997f144965eeaca"),
  ),
  instrumentServerFunction: vi.fn(
    async (run: () => Promise<unknown>, _options: unknown) => run(),
  ),
}));

vi.mock("@tanstack/react-start", () => ({
  createMiddleware: middlewareMocks.createMiddleware,
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: middlewareMocks.getRequest,
}));

vi.mock("./server-fn-runtime.js", () => ({
  instrumentServerFunction: middlewareMocks.instrumentServerFunction,
}));

import { createServerFnTelemetryMiddleware } from "./server-fn-middleware.js";

const testMiddleware = createServerFnTelemetryMiddleware() as unknown as {
  runServer: (options: {
    next: () => Promise<unknown>;
    serverFnMeta: { filename: string; id: string; name: string };
  }) => Promise<unknown>;
};

describe("createServerFnTelemetryMiddleware", () => {
  it("passes TanStack server function metadata to telemetry instrumentation", async () => {
    const next = vi.fn(async () => "ok");
    const serverFnMeta = {
      filename: "src/lib/auth.server.ts",
      id: "c4d3d0c28997f144965eeaca",
      name: "getActiveOrganization",
    };

    await expect(
      testMiddleware.runServer({
        next,
        serverFnMeta,
      }),
    ).resolves.toBe("ok");

    expect(middlewareMocks.instrumentServerFunction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        request: new Request(
          "http://localhost/_serverFn/c4d3d0c28997f144965eeaca",
        ),
        serverFnMeta,
        tracer: expect.any(Object),
      }),
    );
  });

  it("reaches instrumentation synchronously once the import is warm", async () => {
    const serverFnMeta = {
      filename: "src/lib/auth.server.ts",
      id: "c4d3d0c28997f144965eeaca",
      name: "getActiveOrganization",
    };

    // First call resolves the dynamic import.
    await testMiddleware.runServer({ next: async () => "ok", serverFnMeta });
    middlewareMocks.instrumentServerFunction.mockClear();

    // Second call must not yield: the span has to open in the same tick, so
    // that it nests under whatever context is active at the call site.
    const pending = testMiddleware.runServer({
      next: async () => "ok",
      serverFnMeta,
    });
    expect(middlewareMocks.instrumentServerFunction).toHaveBeenCalledTimes(1);

    await pending;
  });
});
