import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMcpHandler: vi.fn(),
  withMcpAuth: vi.fn(),
  transport: vi.fn(),
}));

vi.mock("mcp-handler", () => ({
  createMcpHandler: mocks.createMcpHandler,
  withMcpAuth: mocks.withMcpAuth,
}));
vi.mock("@/lib/mcp-resource", () => ({
  AUTH_ISSUER: "http://localhost:3000/api/auth",
  MCP_RESOURCE: "http://localhost:3000/mcp",
}));
vi.mock("@/db/client", () => ({ db: {} }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("TSS_PRERENDERING", undefined);
  mocks.createMcpHandler.mockReturnValue(mocks.transport);
  mocks.withMcpAuth.mockReturnValue(mocks.transport);
  mocks.transport.mockImplementation(
    async () =>
      new Response("Unauthorized", {
        status: 401,
        headers: { "www-authenticate": "Bearer" },
      }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("MCP transport lifecycle", () => {
  it("does not initialize the transport during prerendering", async () => {
    vi.stubEnv("TSS_PRERENDERING", "true");
    const { Route } = await import("./$");
    expect(mocks.createMcpHandler).not.toHaveBeenCalled();

    const handlers = Route.options.server?.handlers;
    if (!handlers || typeof handlers === "function")
      throw new Error("Missing handlers");
    const response = await handlers.OPTIONS?.({} as never);
    if (!(response instanceof Response)) throw new Error("Expected a response");
    expect(response.status).toBe(204);
    expect(mocks.createMcpHandler).not.toHaveBeenCalled();

    await expect(
      handlers.GET?.({
        request: new Request("http://localhost:3000/mcp"),
      } as never),
    ).rejects.toThrow("MCP requests are unavailable during prerendering");
    expect(mocks.createMcpHandler).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "false",
  ])("initializes at module load with TSS_PRERENDERING=%s and reuses the transport", async (prerendering) => {
    vi.stubEnv("TSS_PRERENDERING", prerendering);
    const { Route } = await import("./$");
    expect(mocks.createMcpHandler).toHaveBeenCalledTimes(1);
    expect(mocks.withMcpAuth).toHaveBeenCalledTimes(1);
    const handlers = Route.options.server?.handlers;
    if (!handlers || typeof handlers === "function")
      throw new Error("Missing handlers");
    const request = new Request("http://localhost:3000/mcp");

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await handlers.GET?.({ request } as never);
      if (!(response instanceof Response))
        throw new Error("Expected a response");
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    }

    expect(mocks.createMcpHandler).toHaveBeenCalledTimes(1);
    expect(mocks.withMcpAuth).toHaveBeenCalledWith(
      mocks.transport,
      expect.any(Function),
      expect.objectContaining({ required: true }),
    );
    expect(mocks.transport).toHaveBeenCalledTimes(2);
  });

  it("surfaces runtime initialization failures when the module loads", async () => {
    mocks.createMcpHandler.mockImplementationOnce(() => {
      throw new Error("Transport initialization failed");
    });
    await expect(import("./$")).rejects.toThrow(
      "Transport initialization failed",
    );
  });
});
