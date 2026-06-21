import { beforeEach, describe, expect, it, vi } from "vitest";

const dashboardReconciler = vi.fn();
const notebookReconciler = vi.fn();
const alertReconciler = vi.fn();
vi.mock("@/data/dashboards/apply.server", () => ({
  applyDashboardSpecs: (...a: unknown[]) => dashboardReconciler(...a),
}));
vi.mock("@/data/notebooks/apply.server", () => ({
  applyNotebookSpecs: (...a: unknown[]) => notebookReconciler(...a),
}));
vi.mock("@/data/alerts/apply.server", () => ({
  applyAlertSpecs: (...a: unknown[]) => alertReconciler(...a),
}));
// Cross-kind notebook-link validation is exercised in its own suite; mock it
// here so the orchestration test stays focused on routing and avoids the
// notebook-links module's transitive DB import.
const validateNotebookLinks = vi.fn();
vi.mock("@/data/alerts/notebook-links.server", () => ({
  validateAlertNotebookLinks: (...a: unknown[]) => validateNotebookLinks(...a),
}));

import { ApplyValidationError } from "./errors";
import { applyResources } from "./registry";

const empty = { created: [], updated: [], deleted: [] };

beforeEach(() => {
  vi.clearAllMocks();
  dashboardReconciler.mockResolvedValue(empty);
  notebookReconciler.mockResolvedValue(empty);
  alertReconciler.mockResolvedValue(empty);
});

describe("applyResources", () => {
  it("routes each state key to its reconciler with repoid and returns a per-kind summary", async () => {
    const dash = { path: "d.yaml", resource: { kind: "Dashboard" } };
    const notebook = { path: "n.yaml", resource: { kind: "Notebook" } };
    const alert = { path: "a.yaml", resource: { kind: "AlertRule" } };
    dashboardReconciler.mockResolvedValue({
      created: ["cpu"],
      updated: [],
      deleted: [],
    });
    notebookReconciler.mockResolvedValue({
      created: ["runbook"],
      updated: [],
      deleted: [],
    });
    const out = await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      state: { dashboards: [dash], notebooks: [notebook], alerts: [alert] },
      dryRun: false,
    });
    expect(dashboardReconciler).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        repoid: "repo-1",
        resources: [dash],
      }),
    );
    expect(notebookReconciler).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        repoid: "repo-1",
        resources: [notebook],
      }),
    );
    expect(alertReconciler).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        repoid: "repo-1",
        resources: [alert],
      }),
    );
    expect(out).toEqual({
      dryRun: false,
      results: [
        { kind: "Dashboard", created: ["cpu"], updated: [], deleted: [] },
        { kind: "Notebook", created: ["runbook"], updated: [], deleted: [] },
        { kind: "AlertRule", created: [], updated: [], deleted: [] },
      ],
    });
  });

  it("validates every kind before any kind writes (an invalid Notebook blocks Dashboard's real apply)", async () => {
    // A Notebook that fails validation: it throws on the no-write dry-run pass,
    // exactly as buildDesiredNotebookSet would for a malformed document.
    notebookReconciler.mockRejectedValue(
      new ApplyValidationError("bad notebook"),
    );

    await expect(
      applyResources({
        orgId: "org-1",
        repoid: "repo-1",
        state: {
          dashboards: [{ path: "d.yaml", resource: { kind: "Dashboard" } }],
          notebooks: [{ path: "n.yaml", resource: { kind: "Notebook" } }],
          alerts: [],
        },
        dryRun: false,
      }),
    ).rejects.toThrow(/bad notebook/);

    // Dashboard was only ever validated (dryRun: true) — never applied for real,
    // so it cannot have pruned the repo before Notebook validation threw.
    expect(dashboardReconciler).not.toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false }),
    );
  });

  it("dryRun reconciles every kind once with dryRun:true and returns the validated diff", async () => {
    dashboardReconciler.mockResolvedValue({
      created: ["cpu"],
      updated: [],
      deleted: [],
    });
    const out = await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      state: { dashboards: [], notebooks: [], alerts: [] },
      dryRun: true,
    });
    expect(dashboardReconciler).toHaveBeenCalledTimes(1);
    expect(dashboardReconciler).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    );
    expect(out.dryRun).toBe(true);
    expect(out.results).toContainEqual({
      kind: "Dashboard",
      created: ["cpu"],
      updated: [],
      deleted: [],
    });
  });

  it("reconciles every kind even when its array is empty (prunes within repoid)", async () => {
    await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      state: { dashboards: [], notebooks: [], alerts: [] },
    });
    expect(dashboardReconciler).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false }),
    );
    expect(notebookReconciler).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false }),
    );
    expect(alertReconciler).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false }),
    );
  });

  it("rejects resources placed under the wrong state key", async () => {
    await expect(
      applyResources({
        orgId: "org-1",
        repoid: "repo-1",
        state: {
          dashboards: [{ path: "alert.yaml", resource: { kind: "AlertRule" } }],
          notebooks: [],
          alerts: [],
        },
      }),
    ).rejects.toThrow('alert.yaml: expected kind "Dashboard"');

    expect(dashboardReconciler).not.toHaveBeenCalled();
    expect(notebookReconciler).not.toHaveBeenCalled();
    expect(alertReconciler).not.toHaveBeenCalled();
  });
});
