import { beforeEach, describe, expect, it, vi } from "vitest";

const applyResources = vi.fn();
vi.mock("@/data/apply/registry", () => ({
  applyResources: (...a: unknown[]) => applyResources(...a),
}));

import { Route } from "./apply";

const POST = (
  Route.options as unknown as {
    server: {
      handlers: {
        POST: (a: {
          request: Request;
          context: { session: { session: { activeOrganizationId: string } } };
        }) => Promise<Response>;
      };
    };
  }
).server.handlers.POST;

const ctx = { session: { session: { activeOrganizationId: "org-1" } } };
const req = (body: unknown) =>
  new Request("http://x/api/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/apply", () => {
  it("applies and returns the per-kind summary", async () => {
    applyResources.mockResolvedValueOnce({
      dryRun: false,
      results: [
        { kind: "Dashboard", created: ["cpu"], updated: [], deleted: [] },
      ],
    });
    const res = await POST({
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
      dryRun: false,
      results: [
        { kind: "Dashboard", created: ["cpu"], updated: [], deleted: [] },
      ],
    });
    expect(applyResources).toHaveBeenCalledWith({
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
    const res = await POST({ request: req({ documents: [] }), context: ctx });
    expect(res.status).toBe(400);
    expect(applyResources).not.toHaveBeenCalled();
  });

  it("returns 400 when applyResources throws", async () => {
    applyResources.mockRejectedValueOnce(
      new Error('bad.yaml: unknown kind "Gizmo"'),
    );
    const res = await POST({
      request: req({
        source: "team",
        documents: [{ path: "bad.yaml", document: { kind: "Gizmo" } }],
      }),
      context: ctx,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Gizmo/);
  });
});
