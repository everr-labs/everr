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
            applyActions: readonly string[] | null;
          };
        }) => Promise<Response>;
      };
    };
  }
).server.handlers.POST;

// Session-authenticated ctx: applyActions null means "no per-action
// restriction" — the action gate is skipped.
const ctx = {
  session: { session: { activeOrganizationId: "org-1" } },
  organization: { id: "org-1", name: "Acme" },
  applyActions: null,
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
          notebooks: [],
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
        notebooks: [],
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
          notebooks: [],
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
          notebooks: [],
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

  // A minimal valid apply state so the action-gate tests can focus on the
  // dryRun flag and the key's applyActions without restating a full body.
  const minimalState = {
    repoid: "repo-1",
    state: { dashboards: [], notebooks: [], alerts: [] },
  };

  describe("apply action gate (read-only keys)", () => {
    it("rejects a read-only key on a mutative apply (dryRun: false)", async () => {
      applyResources.mockResolvedValueOnce({ dryRun: false, results: [] });
      const res = await POST({
        request: req({ ...minimalState, dryRun: false }),
        context: { ...ctx, applyActions: ["read"] },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        error: expect.stringMatching(/read-only/i),
      });
      expect(applyResources).not.toHaveBeenCalled();
    });

    it("rejects a read-only key when dryRun defaults to false (omitted)", async () => {
      applyResources.mockResolvedValueOnce({ dryRun: false, results: [] });
      const res = await POST({
        request: req({ ...minimalState }),
        context: { ...ctx, applyActions: ["read"] },
      });
      expect(res.status).toBe(403);
      expect(applyResources).not.toHaveBeenCalled();
    });

    it("lets a read-only key run a dry-run plan pass", async () => {
      applyResources.mockResolvedValueOnce({ dryRun: true, results: [] });
      const res = await POST({
        request: req({ ...minimalState, dryRun: true }),
        context: { ...ctx, applyActions: ["read"] },
      });
      expect(res.status).toBe(200);
      expect(applyResources).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: true }),
      );
    });

    it("lets a write key run a mutative apply", async () => {
      applyResources.mockResolvedValueOnce({ dryRun: false, results: [] });
      const res = await POST({
        request: req({ ...minimalState, dryRun: false }),
        context: { ...ctx, applyActions: ["read", "write", "delete"] },
      });
      expect(res.status).toBe(200);
    });

    it("lets a wildcard-apply key run a mutative apply", async () => {
      applyResources.mockResolvedValueOnce({ dryRun: false, results: [] });
      const res = await POST({
        request: req({ ...minimalState, dryRun: false }),
        context: { ...ctx, applyActions: ["*"] },
      });
      expect(res.status).toBe(200);
    });

    it("rejects a delete-only key on a mutative apply (write required)", async () => {
      applyResources.mockResolvedValueOnce({ dryRun: false, results: [] });
      const res = await POST({
        request: req({ ...minimalState, dryRun: false }),
        context: { ...ctx, applyActions: ["delete"] },
      });
      expect(res.status).toBe(403);
      expect(applyResources).not.toHaveBeenCalled();
    });

    it("does not gate session-authenticated apply (applyActions null)", async () => {
      applyResources.mockResolvedValueOnce({ dryRun: false, results: [] });
      const res = await POST({
        request: req({ ...minimalState, dryRun: false }),
        context: { ...ctx, applyActions: null },
      });
      expect(res.status).toBe(200);
    });
  });
});
