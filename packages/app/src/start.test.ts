import type * as ReactStartTypes from "@tanstack/react-start";
import { describe, expect, it, vi } from "vite-plus/test";

const startMocks = vi.hoisted(() => ({
  createStart: vi.fn((factory: () => unknown) => factory()),
  requestMiddleware: { name: "request-telemetry" },
  functionMiddleware: { name: "server-fn-telemetry" },
  createRequestTelemetryMiddleware: vi.fn(),
  createServerFnTelemetryMiddleware: vi.fn(),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactStartTypes>()),
  createStart: startMocks.createStart,
}));

vi.mock("@everr/tanstack-start-otel", () => ({
  createRequestTelemetryMiddleware: startMocks.createRequestTelemetryMiddleware.mockReturnValue(
    startMocks.requestMiddleware,
  ),
  createServerFnTelemetryMiddleware: startMocks.createServerFnTelemetryMiddleware.mockReturnValue(
    startMocks.functionMiddleware,
  ),
}));

// The real module pulls the whole generated route tree into this test.
vi.mock("#app/router.tsx", () => ({ getRouter: vi.fn() }));

describe("startInstance", () => {
  it("registers the telemetry request and server function middleware", async () => {
    const { startInstance } = await import("./start");

    expect(startInstance).toEqual({
      defaultSsr: false,
      requestMiddleware: [
        expect.objectContaining({
          options: expect.objectContaining({
            type: "request",
            server: expect.any(Function),
          }),
        }),
        startMocks.requestMiddleware,
      ],
      functionMiddleware: [startMocks.functionMiddleware],
    });
  });

  it("gives the request middleware the app's own router factory", async () => {
    await import("./start");

    const { getRouter } = await import("#app/router.tsx");
    const options = startMocks.createRequestTelemetryMiddleware.mock.calls[0]?.[0];
    options?.router();
    expect(getRouter).toHaveBeenCalled();
  });
});
