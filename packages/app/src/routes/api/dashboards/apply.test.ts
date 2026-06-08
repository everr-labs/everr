import { beforeEach, describe, expect, it, vi } from "vitest";

const applyDashboardSpecs = vi.fn();
vi.mock("@/data/dashboards/server", () => ({
  applyDashboardSpecs: (...a: unknown[]) => applyDashboardSpecs(...a),
}));

import { Route } from "./apply";

type PostHandler = (args: {
  request: Request;
  context: { session: { session: { activeOrganizationId: string } } };
}) => Promise<Response>;

function getHandler(): PostHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { POST?: PostHandler } };
  };
  const handler = routeOptions.server?.handlers?.POST;
  if (!handler)
    throw new Error("Missing POST handler for /api/dashboards/apply.");
  return handler;
}

const ctx = { session: { session: { activeOrganizationId: "org-1" } } };

function req(body: unknown): Request {
  return new Request("http://x/api/dashboards/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/dashboards/apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies and returns the summary", async () => {
    applyDashboardSpecs.mockResolvedValueOnce({
      created: ["cpu"],
      updated: [],
      deleted: [],
      dryRun: false,
    });
    const res = await getHandler()({
      request: req({
        source: "team",
        documents: [
          {
            path: "cpu.yaml",
            document: {
              kind: "Dashboard",
              metadata: { name: "cpu" },
              spec: { panels: {}, layouts: [] },
            },
          },
        ],
      }),
      context: ctx,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      created: ["cpu"],
      updated: [],
      deleted: [],
      dryRun: false,
    });
    expect(applyDashboardSpecs).toHaveBeenCalledWith({
      orgId: "org-1",
      source: "team",
      documents: [
        {
          path: "cpu.yaml",
          document: {
            kind: "Dashboard",
            metadata: { name: "cpu" },
            spec: { panels: {}, layouts: [] },
          },
        },
      ],
      dryRun: undefined,
    });
  });

  it("returns 400 on an invalid body", async () => {
    const res = await getHandler()({
      request: req({ documents: [] }),
      context: ctx,
    });
    expect(res.status).toBe(400);
    expect(applyDashboardSpecs).not.toHaveBeenCalled();
  });

  it("returns 400 when applyDashboardSpecs throws", async () => {
    applyDashboardSpecs.mockRejectedValueOnce(
      new Error("bad.yaml: invalid dashboard spec"),
    );
    const res = await getHandler()({
      request: req({
        source: "team",
        documents: [{ path: "bad.yaml", document: {} }],
      }),
      context: ctx,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/bad\.yaml/);
  });
});
