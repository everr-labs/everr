import { describe, expect, it, vi } from "vitest";

const middlewareMocks = vi.hoisted(() => ({
  createMiddleware: vi.fn(() => ({
    server: vi.fn((serverFn: unknown) => ({ runServer: serverFn })),
  })),
  getRequest: vi.fn(
    () => new Request("http://localhost/_serverFn/c4d3d0c28997f144965eeaca"),
  ),
  instrumentServerFunction: vi.fn(
    async (
      _request: Request | undefined,
      _serverFnMeta: unknown,
      run: () => Promise<unknown>,
    ) => run(),
  ),
}));

vi.mock("@tanstack/react-start", () => ({
  createMiddleware: middlewareMocks.createMiddleware,
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: middlewareMocks.getRequest,
}));

vi.mock("./server-fn-runtime", () => ({
  instrumentServerFunction: middlewareMocks.instrumentServerFunction,
}));

import { serverFnTelemetryMiddleware } from "./server-fn";

const testMiddleware = serverFnTelemetryMiddleware as unknown as {
  runServer: (options: {
    next: () => Promise<unknown>;
    serverFnMeta: { filename: string; id: string; name: string };
  }) => Promise<unknown>;
};

describe("serverFnTelemetryMiddleware", () => {
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
      new Request("http://localhost/_serverFn/c4d3d0c28997f144965eeaca"),
      serverFnMeta,
      expect.any(Function),
    );
  });
});
