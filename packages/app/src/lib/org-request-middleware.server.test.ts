import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { requireOrgRequestMiddleware } from "./org-request-middleware.server";
import type { FunctionMiddlewareHandler } from "./test-middleware";

const mocked = vi.hoisted(() => ({
  getSession: vi.fn(),
  findOrganizationForMember: vi.fn(),
}));

vi.mock("#app/db/client.ts", () => ({ db: {} }));
vi.mock("#app/lib/session.server.ts", () => ({ getSession: mocked.getSession }));
vi.mock("#app/lib/organization-membership.server.ts", () => ({
  findOrganizationForMember: mocked.findOrganizationForMember,
}));

const { __handler: handler } = requireOrgRequestMiddleware as unknown as {
  __handler: FunctionMiddlewareHandler;
};

function run() {
  const next = vi.fn(async (options?: unknown) => options);
  const result = handler({ request: new Request("https://everr.test/api/cli/sql"), next });
  return { result, next };
}

beforeEach(() => {
  mocked.getSession.mockReset();
  mocked.findOrganizationForMember.mockReset();
});

describe("requireOrgRequestMiddleware", () => {
  it("answers 401 without a valid session", async () => {
    mocked.getSession.mockResolvedValue(null);
    const { result, next } = run();

    const response = (await result) as Response;
    expect(response.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes the session and organization to the route", async () => {
    mocked.getSession.mockResolvedValue({
      session: { activeOrganizationId: "org-1" },
      user: { id: "user-1" },
    });
    mocked.findOrganizationForMember.mockResolvedValue({
      id: "org-1",
      name: "Acme",
      metadata: null,
      memberRole: "member",
    });
    const { result, next } = run();

    await result;
    expect(next).toHaveBeenCalledWith({
      context: {
        organization: { id: "org-1", name: "Acme", metadata: null },
        memberRole: "member",
        session: {
          session: { activeOrganizationId: "org-1" },
          user: { id: "user-1" },
        },
      },
    });
  });
});
