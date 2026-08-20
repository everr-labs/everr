import { describe, expect, it, vi } from "vitest";

type CsrfOptions = {
  filter: (ctx: { handlerType: string }) => boolean;
};

const startMocks = vi.hoisted(() => ({
  createStart: vi.fn((factory: () => unknown) => factory()),
  createCsrfMiddleware: vi.fn((_options: CsrfOptions) => ({ name: "csrf" })),
  serverFnTelemetryMiddleware: { name: "server-fn-telemetry" },
}));

vi.mock("@tanstack/react-start", () => ({
  createStart: startMocks.createStart,
  createCsrfMiddleware: startMocks.createCsrfMiddleware,
}));

vi.mock("@/telemetry/server-fn", () => ({
  serverFnTelemetryMiddleware: startMocks.serverFnTelemetryMiddleware,
}));

describe("startInstance", () => {
  it("registers CSRF and telemetry middleware", async () => {
    const { startInstance } = await import("./start");

    expect(startInstance).toEqual({
      requestMiddleware: [{ name: "csrf" }],
      functionMiddleware: [startMocks.serverFnTelemetryMiddleware],
    });
  });

  it("scopes CSRF protection to server functions", async () => {
    await import("./start");

    const { filter } = startMocks.createCsrfMiddleware.mock.calls[0][0];

    expect(filter({ handlerType: "serverFn" })).toBe(true);
    expect(filter({ handlerType: "request" })).toBe(false);
  });
});
