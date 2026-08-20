import { describe, expect, it, vi } from "vitest";

const startMocks = vi.hoisted(() => ({
  createStart: vi.fn((factory: () => unknown) => factory()),
  serverFnTelemetryMiddleware: { name: "server-fn-telemetry" },
}));

vi.mock("@tanstack/react-start", () => ({
  createStart: startMocks.createStart,
}));

vi.mock("@/telemetry/server-fn", () => ({
  serverFnTelemetryMiddleware: startMocks.serverFnTelemetryMiddleware,
}));

describe("startInstance", () => {
  it("registers telemetry server function middleware", async () => {
    const { startInstance } = await import("./start");

    expect(startInstance).toEqual({
      defaultSsr: false,
      functionMiddleware: [startMocks.serverFnTelemetryMiddleware],
    });
  });
});
