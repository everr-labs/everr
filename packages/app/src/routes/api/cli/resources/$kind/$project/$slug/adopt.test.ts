import { beforeEach, describe, expect, it, vi } from "vitest";
import { adoptResource } from "@/data/as-code/resource-admin.server";
import { getRouteHandler } from "../../../../-test-utils";
import { Route } from "./adopt";

vi.mock("@/db/client", () => ({
  db: { select: vi.fn(), delete: vi.fn(), update: vi.fn() },
}));

vi.mock("@/data/as-code/resource-admin.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/data/as-code/resource-admin.server")
  >()),
  adoptResource: vi.fn(),
}));

const mockedAdopt = vi.mocked(adoptResource);

type Ctx = {
  session: { session: { activeOrganizationId: string } };
};
type Handler = (args: {
  request: Request;
  context: Ctx;
  params: { kind: string; project: string; slug: string };
}) => Promise<Response>;

const url = "http://localhost/api/cli/resources/dashboard/default/errors/adopt";
const params = { kind: "dashboard", project: "default", slug: "errors" };
const rwCtx: Ctx = {
  session: { session: { activeOrganizationId: "org-42" } },
};

function post(body: unknown, context: Ctx, p = params): Promise<Response> {
  const handler = getRouteHandler<Handler>(Route, "POST", "adopt");
  return handler({
    request: new Request(url, { method: "POST", body: JSON.stringify(body) }),
    context,
    params: p,
  });
}

beforeEach(() => vi.clearAllMocks());

describe("POST .../adopt", () => {
  it("reassigns the repoid and reports the outcome", async () => {
    mockedAdopt.mockResolvedValueOnce({ found: true, alreadyOwned: false });
    const res = await post({ repoid: "github.com/acme/app" }, rwCtx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      kind: "dashboard",
      project: "default",
      slug: "errors",
      repoid: "github.com/acme/app",
      alreadyOwned: false,
    });
    expect(mockedAdopt).toHaveBeenCalledWith(
      "org-42",
      "dashboard",
      "default",
      "errors",
      "github.com/acme/app",
    );
  });

  it("reports already-owned as a no-op success", async () => {
    mockedAdopt.mockResolvedValueOnce({ found: true, alreadyOwned: true });
    const res = await post({ repoid: "github.com/acme/app" }, rwCtx);
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyOwned).toBe(true);
  });

  it("404s when the resource is missing", async () => {
    mockedAdopt.mockResolvedValueOnce({ found: false, alreadyOwned: false });
    const res = await post({ repoid: "github.com/acme/app" }, rwCtx);
    expect(res.status).toBe(404);
  });

  it("400s on empty repoid", async () => {
    const res = await post({ repoid: "" }, rwCtx);
    expect(res.status).toBe(400);
    expect(mockedAdopt).not.toHaveBeenCalled();
  });

  it("403s the built-in pseudo-project", async () => {
    const res = await post({ repoid: "github.com/acme/app" }, rwCtx, {
      kind: "dashboard",
      project: "built-in",
      slug: "log-overview",
    });
    expect(res.status).toBe(403);
    expect(mockedAdopt).not.toHaveBeenCalled();
  });
});
