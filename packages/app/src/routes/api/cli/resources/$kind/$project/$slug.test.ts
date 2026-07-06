import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteResource,
  getResource,
} from "@/data/as-code/resource-admin.server";
import { getRouteHandler } from "../../../-test-utils";
import { Route } from "./$slug";

vi.mock("@/db/client", () => ({
  db: { select: vi.fn(), delete: vi.fn(), update: vi.fn() },
}));

vi.mock("@/data/as-code/resource-admin.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/data/as-code/resource-admin.server")
  >()),
  getResource: vi.fn(),
  deleteResource: vi.fn(),
}));

const mockedGet = vi.mocked(getResource);
const mockedDelete = vi.mocked(deleteResource);

type Ctx = {
  session: { session: { activeOrganizationId: string } };
  applyActions: readonly string[] | null;
};
type Handler = (args: {
  request: Request;
  context: Ctx;
  params: { kind: string; project: string; slug: string };
}) => Promise<Response>;

const url = "http://localhost/api/cli/resources/dashboard/default/errors";
const params = { kind: "dashboard", project: "default", slug: "errors" };
const rwCtx: Ctx = {
  session: { session: { activeOrganizationId: "org-42" } },
  applyActions: null,
};
const roCtx: Ctx = {
  session: { session: { activeOrganizationId: "org-42" } },
  applyActions: ["read"],
};

beforeEach(() => vi.clearAllMocks());

describe("GET .../$kind/$project/$slug", () => {
  function get(): Handler {
    return getRouteHandler<Handler>(Route, "GET", "show");
  }

  it("returns the stored document", async () => {
    mockedGet.mockResolvedValueOnce({ kind: "Dashboard", metadata: {} });
    const res = await get()({
      request: new Request(url),
      context: rwCtx,
      params,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "Dashboard", metadata: {} });
    expect(mockedGet).toHaveBeenCalledWith(
      "org-42",
      "dashboard",
      "default",
      "errors",
    );
  });

  it("404s when the resource is missing", async () => {
    mockedGet.mockResolvedValueOnce(null);
    const res = await get()({
      request: new Request(url),
      context: rwCtx,
      params,
    });
    expect(res.status).toBe(404);
  });

  it("400s on unknown kind", async () => {
    const res = await get()({
      request: new Request(url),
      context: rwCtx,
      params: { ...params, kind: "nope" },
    });
    expect(res.status).toBe(400);
    expect(mockedGet).not.toHaveBeenCalled();
  });
});

describe("DELETE .../$kind/$project/$slug", () => {
  function del(): Handler {
    return getRouteHandler<Handler>(Route, "DELETE", "delete");
  }

  it("deletes and returns ok", async () => {
    mockedDelete.mockResolvedValueOnce(true);
    const res = await del()({
      request: new Request(url, { method: "DELETE" }),
      context: rwCtx,
      params,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      kind: "dashboard",
      project: "default",
      slug: "errors",
    });
  });

  it("404s when nothing was deleted", async () => {
    mockedDelete.mockResolvedValueOnce(false);
    const res = await del()({
      request: new Request(url, { method: "DELETE" }),
      context: rwCtx,
      params,
    });
    expect(res.status).toBe(404);
  });

  it("403s a read-only API key", async () => {
    const res = await del()({
      request: new Request(url, { method: "DELETE" }),
      context: roCtx,
      params,
    });
    expect(res.status).toBe(403);
    expect(mockedDelete).not.toHaveBeenCalled();
  });
});
