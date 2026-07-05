import { beforeEach, describe, expect, it, vi } from "vitest";

const dashboardReconciler = vi.fn();
const runbookReconciler = vi.fn();
const alertReconciler = vi.fn();
vi.mock("@/data/dashboards/apply.server", () => ({
  applyDashboardSpecs: (...a: unknown[]) => dashboardReconciler(...a),
}));
vi.mock("@/data/runbooks/apply.server", () => ({
  applyRunbookSpecs: (...a: unknown[]) => runbookReconciler(...a),
}));
vi.mock("@/data/alerts/apply.server", () => ({
  applyAlertSpecs: (...a: unknown[]) => alertReconciler(...a),
}));
// Cross-kind runbook-link validation is exercised in its own suite; mock it
// here so the orchestration test stays focused on routing and avoids the
// runbook-links module's transitive DB import.
const validateRunbookLinks = vi.fn();
vi.mock("@/data/alerts/runbook-links.server", () => ({
  validateAlertRunbookLinks: (...a: unknown[]) => validateRunbookLinks(...a),
}));

const upsertPreview = vi.fn();
const findPreviewId = vi.fn();
vi.mock("@/data/previews/apply.server", () => ({
  upsertPreview: (...a: unknown[]) => upsertPreview(...a),
  findPreviewId: (...a: unknown[]) => findPreviewId(...a),
}));

// The real apply pass runs inside one db.transaction; the mock just invokes
// the callback with a stand-in executor so the reconcilers (also mocked) run.
vi.mock("@/db/client", () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ tx: true }),
    ),
  },
}));

import { ApplyValidationError } from "./errors";
import { applyResources } from "./registry";

const empty = {
  created: [],
  updated: [],
  deleted: [],
  adopted: [],
  conflicts: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  dashboardReconciler.mockResolvedValue(empty);
  runbookReconciler.mockResolvedValue(empty);
  alertReconciler.mockResolvedValue(empty);
  upsertPreview.mockResolvedValue("prev-1");
  findPreviewId.mockResolvedValue(null);
});

describe("applyResources", () => {
  it("routes each state key to its reconciler with repoid and returns a per-kind summary", async () => {
    const dash = { path: "d.yaml", resource: { kind: "Dashboard" } };
    const runbook = { path: "n.yaml", resource: { kind: "Runbook" } };
    const alert = { path: "a.yaml", resource: { kind: "AlertRule" } };
    dashboardReconciler.mockResolvedValue({
      created: ["cpu"],
      updated: [],
      deleted: [],
      adopted: [],
      conflicts: [],
    });
    runbookReconciler.mockResolvedValue({
      created: ["runbook"],
      updated: [],
      deleted: [],
      adopted: [],
      conflicts: [],
    });
    const out = await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      state: { dashboards: [dash], runbooks: [runbook], alerts: [alert] },
      dryRun: false,
    });
    const liveNs = { orgId: "org-1", repoid: "repo-1", kind: "live" };
    expect(dashboardReconciler).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: liveNs, resources: [dash] }),
    );
    expect(runbookReconciler).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: liveNs, resources: [runbook] }),
    );
    expect(alertReconciler).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: liveNs, resources: [alert] }),
    );
    expect(out).toEqual({
      dryRun: false,
      results: [
        {
          kind: "Dashboard",
          created: ["cpu"],
          updated: [],
          deleted: [],
          adopted: [],
        },
        {
          kind: "Runbook",
          created: ["runbook"],
          updated: [],
          deleted: [],
          adopted: [],
        },
        {
          kind: "AlertRule",
          created: [],
          updated: [],
          deleted: [],
          adopted: [],
        },
      ],
    });
  });

  it("validates every kind before any kind writes (an invalid Runbook blocks Dashboard's real apply)", async () => {
    // A Runbook that fails validation: it throws on the no-write dry-run pass,
    // exactly as buildDesiredRunbookSet would for a malformed document.
    runbookReconciler.mockRejectedValue(
      new ApplyValidationError("bad runbook"),
    );

    await expect(
      applyResources({
        orgId: "org-1",
        repoid: "repo-1",
        state: {
          dashboards: [{ path: "d.yaml", resource: { kind: "Dashboard" } }],
          runbooks: [{ path: "n.yaml", resource: { kind: "Runbook" } }],
          alerts: [],
        },
        dryRun: false,
      }),
    ).rejects.toThrow(/bad runbook/);

    // Dashboard was only ever validated (dryRun: true) — never applied for real,
    // so it cannot have pruned the repo before Runbook validation threw.
    expect(dashboardReconciler).not.toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false }),
    );
  });

  it("dryRun reconciles every kind once with dryRun:true and returns the validated diff", async () => {
    dashboardReconciler.mockResolvedValue({
      created: ["cpu"],
      updated: [],
      deleted: [],
      adopted: [],
      conflicts: [],
    });
    const out = await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      state: { dashboards: [], runbooks: [], alerts: [] },
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
      adopted: [],
    });
  });

  it("reconciles every kind even when its array is empty (prunes within repoid)", async () => {
    await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      state: { dashboards: [], runbooks: [], alerts: [] },
    });
    expect(dashboardReconciler).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false }),
    );
    expect(runbookReconciler).toHaveBeenCalledWith(
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
          runbooks: [],
          alerts: [],
        },
      }),
    ).rejects.toThrow('alert.yaml: expected kind "Dashboard"');

    expect(dashboardReconciler).not.toHaveBeenCalled();
    expect(runbookReconciler).not.toHaveBeenCalled();
    expect(alertReconciler).not.toHaveBeenCalled();
  });

  // Kind validation is the only back-compat surface in the rename: `Runbook`
  // is canonical and the legacy `Notebook` kind stays accepted (ADR 0002).
  it.each([
    "Runbook",
    "Notebook",
  ])("accepts kind %s under the runbooks state key (Notebook is the legacy alias)", async (kind) => {
    await expect(
      applyResources({
        orgId: "org-1",
        repoid: "repo-1",
        state: {
          dashboards: [],
          runbooks: [{ path: "rb.yaml", resource: { kind } }],
          alerts: [],
        },
        dryRun: true,
      }),
    ).resolves.toMatchObject({ dryRun: true });
    expect(runbookReconciler).toHaveBeenCalledWith(
      expect.objectContaining({
        resources: [{ path: "rb.yaml", resource: { kind } }],
      }),
    );
  });

  it("honors the Notebook alias only for runbooks — rejects it under dashboards", async () => {
    await expect(
      applyResources({
        orgId: "org-1",
        repoid: "repo-1",
        state: {
          dashboards: [{ path: "nb.yaml", resource: { kind: "Notebook" } }],
          runbooks: [],
          alerts: [],
        },
      }),
    ).rejects.toThrow('nb.yaml: expected kind "Dashboard"');

    expect(dashboardReconciler).not.toHaveBeenCalled();
    expect(runbookReconciler).not.toHaveBeenCalled();
    expect(alertReconciler).not.toHaveBeenCalled();
  });

  it("passes preview to every reconciler and registers the preview once", async () => {
    await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      preview: "gio/x",
      state: { dashboards: [], runbooks: [], alerts: [] },
    });
    for (const reconciler of [
      dashboardReconciler,
      runbookReconciler,
      alertReconciler,
    ]) {
      expect(reconciler).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: {
            orgId: "org-1",
            repoid: "repo-1",
            kind: "preview",
            id: "prev-1",
          },
          dryRun: false,
        }),
      );
    }
    expect(upsertPreview).toHaveBeenCalledTimes(1);
    // Registered first, inside the shared transaction (the executor arg).
    expect(upsertPreview).toHaveBeenCalledWith(expect.anything(), {
      orgId: "org-1",
      repoid: "repo-1",
      name: "gio/x",
    });
  });

  it("does not register a preview for live or dry-run applies", async () => {
    await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      state: { dashboards: [], runbooks: [], alerts: [] },
    });
    await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      preview: "gio/x",
      dryRun: true,
      state: { dashboards: [], runbooks: [], alerts: [] },
    });
    expect(upsertPreview).not.toHaveBeenCalled();
  });

  it("aborts, listing every conflict, when a reconciler reports an ownership clash", async () => {
    dashboardReconciler.mockResolvedValue({
      created: [],
      updated: [],
      deleted: [],
      adopted: [],
      conflicts: [{ project: "default", slug: "cpu", owner: "repo-2" }],
    });
    await expect(
      applyResources({
        orgId: "org-1",
        repoid: "repo-1",
        state: {
          dashboards: [{ path: "d.yaml", resource: { kind: "Dashboard" } }],
          runbooks: [],
          alerts: [],
        },
        dryRun: false,
      }),
    ).rejects.toThrow(/default\/cpu \(owned by repo-2\)[\s\S]*--adopt/);
    // Fail-fast: aborts in the validation pass, before the real apply's
    // transaction ever registers or writes.
    expect(upsertPreview).not.toHaveBeenCalled();
  });

  it("passes adopt through to every reconciler", async () => {
    await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      adopt: true,
      state: { dashboards: [], runbooks: [], alerts: [] },
    });
    expect(dashboardReconciler).toHaveBeenCalledWith(
      expect.objectContaining({ adopt: true }),
    );
    expect(alertReconciler).toHaveBeenCalledWith(
      expect.objectContaining({ adopt: true }),
    );
  });
});
