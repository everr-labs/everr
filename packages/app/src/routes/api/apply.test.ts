import { beforeEach, describe, expect, it, vi } from "vitest";

const applyResources = vi.fn();
vi.mock("@/data/as-code/registry", () => ({
  applyResources: (...a: unknown[]) => applyResources(...a),
}));

// apply-auth.server.ts → db/client has server-only env; stub it out.
vi.mock("@/db/client", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })),
      })),
    })),
  },
}));

import { ApplyValidationError } from "@/data/as-code/errors";
import { Route } from "./apply";

const POST = (
  Route.options as unknown as {
    server: {
      handlers: {
        POST: (a: {
          request: Request;
          context: {
            session: { session: { activeOrganizationId: string } };
            organization: { id: string; name: string };
          };
        }) => Promise<Response>;
      };
    };
  }
).server.handlers.POST;

const ctx = {
  session: { session: { activeOrganizationId: "org-1" } },
  organization: { id: "org-1", name: "Acme" },
};
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
  it("applies and returns the per-kind summary with the org", async () => {
    applyResources.mockResolvedValueOnce({
      dryRun: true,
      results: [
        { kind: "Dashboard", created: ["cpu"], updated: [], deleted: [] },
      ],
    });
    const res = await POST({
      request: req({
        repoid: "repo-1",
        source: {
          branch: "main",
          commitSha: "abc123",
          remote: "git@example.com:acme/repo.git",
        },
        dryRun: true,
        state: {
          dashboards: [
            {
              path: "cpu.yaml",
              resource: {
                kind: "Dashboard",
                metadata: { name: "cpu" },
                spec: { panels: {}, layouts: [] },
              },
            },
          ],
          alerts: [],
        },
      }),
      context: ctx,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      dryRun: true,
      results: [
        { kind: "Dashboard", created: ["cpu"], updated: [], deleted: [] },
      ],
      organization: { id: "org-1", name: "Acme" },
    });
    expect(applyResources).toHaveBeenCalledWith({
      orgId: "org-1",
      repoid: "repo-1",
      state: {
        dashboards: [
          {
            path: "cpu.yaml",
            resource: {
              kind: "Dashboard",
              metadata: { name: "cpu" },
              spec: { panels: {}, layouts: [] },
            },
          },
        ],
        alerts: [],
      },
      source: {
        branch: "main",
        commitSha: "abc123",
        remote: "git@example.com:acme/repo.git",
      },
      dryRun: true,
    });
  });

  it("returns 400 on an invalid body", async () => {
    const res = await POST({ request: req({}), context: ctx });
    expect(res.status).toBe(400);
    expect(applyResources).not.toHaveBeenCalled();
  });

  it("returns 400 with the message on a validation error", async () => {
    applyResources.mockRejectedValueOnce(
      new ApplyValidationError('bad.yaml: unknown kind "Gizmo"'),
    );
    const res = await POST({
      request: req({
        repoid: "repo-1",
        state: {
          dashboards: [{ path: "bad.yaml", resource: { kind: "Dashboard" } }],
          alerts: [],
        },
      }),
      context: ctx,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Gizmo/);
  });

  it("returns an opaque 500 on an infrastructure error (no leak)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    applyResources.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED 10.0.0.5:5432"),
    );
    const res = await POST({
      request: req({
        repoid: "repo-1",
        state: {
          dashboards: [
            {
              path: "cpu.yaml",
              resource: {
                kind: "Dashboard",
                spec: { panels: {}, layouts: [] },
              },
            },
          ],
          alerts: [],
        },
      }),
      context: ctx,
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal error while applying");
    expect(body.error).not.toMatch(/ECONNREFUSED|5432/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
