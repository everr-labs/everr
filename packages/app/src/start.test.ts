import { describe, expect, it, vi } from "vitest";

const startMocks = vi.hoisted(() => ({
  createStart: vi.fn((factory: () => unknown) => factory()),
  serverFnTelemetryMiddleware: { name: "server-fn-telemetry" },
  requestTelemetryMiddleware: { name: "request-telemetry" },
}));

vi.mock("@tanstack/react-start", () => ({
  createStart: startMocks.createStart,
}));

vi.mock("@/telemetry/server-fn", () => ({
  serverFnTelemetryMiddleware: startMocks.serverFnTelemetryMiddleware,
}));

vi.mock("@/telemetry/server", () => ({
  requestTelemetryMiddleware: startMocks.requestTelemetryMiddleware,
}));

describe("startInstance", () => {
  it("registers the telemetry request and server function middleware", async () => {
    const { startInstance } = await import("./start");

    expect(startInstance).toEqual({
      defaultSsr: false,
      requestMiddleware: [startMocks.requestTelemetryMiddleware],
      functionMiddleware: [startMocks.serverFnTelemetryMiddleware],
    });
  });
});
