import { beforeEach, describe, expect, it, vi } from "vitest";

const dashboardReconciler = vi.fn();
const alertReconciler = vi.fn();
vi.mock("@/data/dashboards/apply.server", () => ({
  applyDashboardSpecs: (...a: unknown[]) => dashboardReconciler(...a),
}));
vi.mock("@/data/alerts/apply.server", () => ({
  applyAlertSpecs: (...a: unknown[]) => alertReconciler(...a),
}));

import { applyResources } from "./registry";

const empty = { created: [], updated: [], deleted: [] };

beforeEach(() => {
  vi.clearAllMocks();
  dashboardReconciler.mockResolvedValue(empty);
  alertReconciler.mockResolvedValue(empty);
});

describe("applyResources", () => {
  it("routes state.dashboards and state.alerts to their reconcilers with repoid", async () => {
    const dash = { path: "d.yaml", resource: { kind: "Dashboard" } };
    const alert = { path: "a.yaml", resource: { kind: "AlertRule" } };
    dashboardReconciler.mockResolvedValueOnce({
      created: ["cpu"],
      updated: [],
      deleted: [],
    });
    alertReconciler.mockResolvedValueOnce(empty);
    const out = await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      state: { dashboards: [dash], alerts: [alert] },
      dryRun: false,
    });
    expect(dashboardReconciler).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        repoid: "repo-1",
        resources: [dash],
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
        { kind: "AlertRule", created: [], updated: [], deleted: [] },
      ],
    });
  });

  it("reconciles every kind even when its array is empty (prunes within repoid)", async () => {
    await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      state: { dashboards: [], alerts: [] },
    });
    expect(dashboardReconciler).toHaveBeenCalledOnce();
    expect(alertReconciler).toHaveBeenCalledOnce();
  });
});
