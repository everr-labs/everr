import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const applyResources = vi.fn();
vi.mock("#app/data/as-code/registry.ts", () => ({
  applyResources: (...a: unknown[]) => applyResources(...a),
}));

// apply-auth.server.ts → db/client has server-only env; stub it out.
vi.mock("#app/db/client.ts", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })),
      })),
    })),
  },
}));

import { ApplyValidationError } from "#app/data/as-code/errors.ts";
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
            sql: { queryWithMeta: ReturnType<typeof vi.fn> };
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
  sql: { queryWithMeta: vi.fn() },
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
      results: [{ kind: "Dashboard", created: ["cpu"], updated: [], deleted: [] }],
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
          runbooks: [],
          alerts: [],
        },
      }),
      context: ctx,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      dryRun: true,
      results: [{ kind: "Dashboard", created: ["cpu"], updated: [], deleted: [] }],
      preview: "",
      organization: { id: "org-1", name: "Acme" },
    });
    expect(applyResources).toHaveBeenCalledWith({
      orgId: "org-1",
      sql: ctx.sql,
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
        runbooks: [],
        alerts: [],
      },
      source: {
        branch: "main",
        commitSha: "abc123",
        remote: "git@example.com:acme/repo.git",
      },
      dryRun: true,
      adopt: false,
    });
  });

  it.each([
    { name: "empty body", body: {} },
    {
      name: "unknown state keys",
      body: {
        repoid: "repo-1",
        state: { dashboards: [], runbooks: [], alerts: [], unexpected: [] },
      },
    },
    {
      name: "empty preview name",
      body: { repoid: "repo-1", state: { dashboards: [], runbooks: [], alerts: [] }, preview: "" },
    },
  ])("returns 400 on an invalid body: $name", async ({ body }) => {
    const res = await POST({ request: req(body), context: ctx });
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
          runbooks: [],
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
    applyResources.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
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
          runbooks: [],
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
    state: { dashboards: [], runbooks: [], alerts: [] },
  };

  it.each([
    { name: "read-only key, mutative apply", applyActions: ["read"], dryRun: false, status: 403 },
    {
      name: "read-only key, dryRun omitted",
      applyActions: ["read"],
      dryRun: undefined,
      status: 403,
    },
    { name: "read-only key, dry-run plan", applyActions: ["read"], dryRun: true, status: 200 },
    { name: "write key", applyActions: ["read", "write", "delete"], dryRun: false, status: 200 },
    { name: "wildcard key", applyActions: ["*"], dryRun: false, status: 200 },
    {
      name: "delete-only key (write required)",
      applyActions: ["delete"],
      dryRun: false,
      status: 403,
    },
    { name: "session auth (no gate)", applyActions: null, dryRun: false, status: 200 },
  ])("gates apply actions: $name -> $status", async ({ applyActions, dryRun, status }) => {
    applyResources.mockResolvedValueOnce({ dryRun: dryRun ?? false, results: [] });
    const res = await POST({
      request: req({ ...minimalState, dryRun }),
      context: { ...ctx, applyActions },
    });
    expect(res.status).toBe(status);
    expect(applyResources).toHaveBeenCalledTimes(status === 403 ? 0 : 1);
  });

  it("forwards preview to applyResources and echoes it", async () => {
    applyResources.mockResolvedValue({ dryRun: false, results: [] });
    const res = await POST({
      request: req({
        repoid: "repo-1",
        state: { dashboards: [], runbooks: [], alerts: [] },
        preview: "gio/x",
      }),
      context: ctx,
    });
    expect(res.status).toBe(200);
    expect(applyResources).toHaveBeenCalledWith(expect.objectContaining({ preview: "gio/x" }));
    expect(await res.json()).toMatchObject({ preview: "gio/x" });
  });
});
