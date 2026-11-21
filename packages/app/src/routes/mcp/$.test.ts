import type * as McpHandler from "mcp-handler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  createMcpHandler: vi.fn(),
  withMcpAuth: vi.fn(),
  transport: vi.fn(),
  runSqlForConnection: vi.fn(),
  access: "enabled" as "enabled" | "suspended",
}));

vi.mock("mcp-handler", () => ({
  createMcpHandler: mocks.createMcpHandler,
  withMcpAuth: mocks.withMcpAuth,
}));
vi.mock("#app/lib/mcp-resource.ts", () => ({
  AUTH_BASE: "http://localhost:3000",
  AUTH_ISSUER: "http://localhost:3000/api/auth",
  MCP_RESOURCE: "http://localhost:3000/mcp",
}));
vi.mock("#app/db/client.ts", () => ({ db: {} }));
vi.mock("#app/data/mcp/run-sql.ts", () => ({ runSqlForConnection: mocks.runSqlForConnection }));
vi.mock("@composition/product", () => ({
  product: { forOrganization: async () => ({ access: mocks.access }) },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("TSS_PRERENDERING", undefined);
  mocks.access = "enabled";
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
    if (!handlers || typeof handlers === "function") throw new Error("Missing handlers");
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

  it.each([undefined, "false"])(
    "initializes at module load with TSS_PRERENDERING=%s and reuses the transport",
    async (prerendering) => {
      vi.stubEnv("TSS_PRERENDERING", prerendering);
      const { Route } = await import("./$");
      expect(mocks.createMcpHandler).toHaveBeenCalledTimes(1);
      expect(mocks.withMcpAuth).toHaveBeenCalledTimes(1);
      const handlers = Route.options.server?.handlers;
      if (!handlers || typeof handlers === "function") throw new Error("Missing handlers");
      const request = new Request("http://localhost:3000/mcp");

      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await handlers.GET?.({ request } as never);
        if (!(response instanceof Response)) throw new Error("Expected a response");
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
    },
  );

  it("points the auth challenge at BETTER_AUTH_URL, not the forwarded headers", async () => {
    const actual = await vi.importActual<typeof McpHandler>("mcp-handler");
    mocks.withMcpAuth.mockImplementation(actual.withMcpAuth);
    const { Route } = await import("./$");
    const handlers = Route.options.server?.handlers;
    if (!handlers || typeof handlers === "function") throw new Error("Missing handlers");

    const response = await handlers.POST?.({
      request: new Request("http://localhost:3000/mcp", {
        method: "POST",
        headers: { "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" },
      }),
    } as never);
    if (!(response instanceof Response)) throw new Error("Expected a response");

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"',
    );
    expect(mocks.transport).not.toHaveBeenCalled();
  });

  it("surfaces runtime initialization failures when the module loads", async () => {
    mocks.createMcpHandler.mockImplementationOnce(() => {
      throw new Error("Transport initialization failed");
    });
    await expect(import("./$")).rejects.toThrow("Transport initialization failed");
  });
});

describe("query tool", () => {
  async function queryTool() {
    await import("./$");
    const [register] = mocks.createMcpHandler.mock.calls[0] as [
      (server: { registerTool: (name: string, def: unknown, fn: Function) => void }) => void,
    ];
    const tools = new Map<string, Function>();
    register({ registerTool: (name, _def, fn) => tools.set(name, fn) });
    const query = tools.get("query");
    if (!query) throw new Error("Missing query tool");
    return (sql: string) =>
      query({ sql }, { authInfo: { extra: { orgId: "org", userId: "user", metadata: null } } });
  }

  it("tells the client the organization is suspended instead of running the query", async () => {
    mocks.access = "suspended";
    const query = await queryTool();

    await expect(query("SELECT 1")).resolves.toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining("subscription is suspended") }],
    });
    expect(mocks.runSqlForConnection).not.toHaveBeenCalled();
  });

  it("runs the query for an active organization", async () => {
    mocks.runSqlForConnection.mockResolvedValue({ isError: false, content: ["[]"] });
    const query = await queryTool();

    await expect(query("SELECT 1")).resolves.toMatchObject({ isError: false });
    expect(mocks.runSqlForConnection).toHaveBeenCalledOnce();
  });
});
