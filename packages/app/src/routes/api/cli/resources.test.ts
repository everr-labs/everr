import { beforeEach, describe, expect, it, vi } from "vitest";
import { listResources } from "@/data/as-code/resource-admin.server";
import { getRouteHandler } from "./-test-utils";
import { Route } from "./resources";

vi.mock("@/db/client", () => ({
  db: { select: vi.fn(), delete: vi.fn(), update: vi.fn() },
}));

vi.mock("@/data/as-code/resource-admin.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/data/as-code/resource-admin.server")
  >()),
  listResources: vi.fn(),
}));

const mockedList = vi.mocked(listResources);

type Handler = (args: {
  request: Request;
  context: {
    session: { session: { activeOrganizationId: string } };
    applyActions: readonly string[] | null;
  };
}) => Promise<Response>;

function handler(): Handler {
  return getRouteHandler<Handler>(Route, "GET", "/api/cli/resources");
}

const context = {
  session: { session: { activeOrganizationId: "org-42" } },
  applyActions: null,
};

beforeEach(() => vi.clearAllMocks());

describe("GET /api/cli/resources", () => {
  it("returns all resources for the org", async () => {
    mockedList.mockResolvedValueOnce([
      {
        kind: "dashboard",
        project: "default",
        slug: "errors-to-fix",
        repoid: "github.com/acme/app",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ]);

    const res = await handler()({
      request: new Request("http://localhost/api/cli/resources"),
      context,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        kind: "dashboard",
        project: "default",
        slug: "errors-to-fix",
        repoid: "github.com/acme/app",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ]);
    expect(mockedList).toHaveBeenCalledWith("org-42", {
      kind: undefined,
      repoid: undefined,
    });
  });

  it("passes kind and repoid filters through", async () => {
    mockedList.mockResolvedValueOnce([]);
    await handler()({
      request: new Request(
        "http://localhost/api/cli/resources?kind=runbook&repoid=",
      ),
      context,
    });
    expect(mockedList).toHaveBeenCalledWith("org-42", {
      kind: "runbook",
      repoid: "",
    });
  });

  it("rejects an unknown kind with 400", async () => {
    const res = await handler()({
      request: new Request("http://localhost/api/cli/resources?kind=nope"),
      context,
    });
    expect(res.status).toBe(400);
    expect(mockedList).not.toHaveBeenCalled();
  });
});
