import { beforeEach, describe, expect, it, vi } from "vitest";

const dashboardReconciler = vi.fn();
const runbookReconciler = vi.fn();
const alertReconciler = vi.fn();
const sloReconciler = vi.fn();
vi.mock("@/data/dashboards/apply.server", () => ({
  applyDashboardSpecs: (...a: unknown[]) => dashboardReconciler(...a),
}));
vi.mock("@/data/runbooks/apply.server", () => ({
  applyRunbookSpecs: (...a: unknown[]) => runbookReconciler(...a),
}));
vi.mock("@/data/alerts/apply.server", () => ({
  applyAlertSpecs: (...a: unknown[]) => alertReconciler(...a),
}));
vi.mock("@/data/slos/apply.server", () => ({
  applySloSpecs: (...a: unknown[]) => sloReconciler(...a),
}));
// Cross-kind runbook-link validation is exercised in its own suite; mock it
// here so the orchestration test stays focused on routing and avoids the
// runbook-links module's transitive DB/alerting engine imports.
const validateRunbookLinks = vi.fn();
const collectOrphanWarnings = vi.fn();
vi.mock("./runbook-links.server", () => ({
  validateRunbookLinks: (...a: unknown[]) => validateRunbookLinks(...a),
  collectOrphanWarnings: (...a: unknown[]) => collectOrphanWarnings(...a),
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

import { db } from "@/db/client";
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
  sloReconciler.mockResolvedValue(empty);
  upsertPreview.mockResolvedValue("prev-1");
  findPreviewId.mockResolvedValue(null);
  collectOrphanWarnings.mockResolvedValue([]);
});

describe("applyResources", () => {
  it("routes each state key to its reconciler with repoid and returns a per-kind summary", async () => {
    const dash = { path: "d.yaml", resource: { kind: "Dashboard" } };
    const runbook = { path: "n.yaml", resource: { kind: "Runbook" } };
    const alert = { path: "a.yaml", resource: { kind: "AlertRule" } };
    const slo = { path: "s.yaml", resource: { kind: "SLO" } };
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
    sloReconciler.mockResolvedValue({
      created: ["checkout"],
      updated: [],
      deleted: [],
      adopted: [],
      conflicts: [],
    });
    const out = await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      state: {
        dashboards: [dash],
        runbooks: [runbook],
        alerts: [alert],
        slos: [slo],
      },
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
    expect(sloReconciler).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: liveNs, resources: [slo] }),
    );
    expect(validateRunbookLinks).toHaveBeenCalledWith({
      namespace: liveNs,
      alerts: [alert],
      slos: [slo],
      runbooks: [runbook],
    });
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
        {
          kind: "SLO",
          created: ["checkout"],
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

    try {
      await applyResources({
        orgId: "org-1",
        repoid: "repo-1",
        state: {
          dashboards: [{ path: "d.yaml", resource: { kind: "Dashboard" } }],
          runbooks: [{ path: "n.yaml", resource: { kind: "Runbook" } }],
          alerts: [],
          slos: [],
        },
        dryRun: false,
      });
      expect.fail("expected the invalid runbook to fail the apply");
    } catch (error) {
      expect((error as Error).message).toMatch(/bad runbook/);
    }

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
      state: {
        dashboards: [],
        runbooks: [],
        alerts: [],
        slos: [],
      },
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
      state: {
        dashboards: [],
        runbooks: [],
        alerts: [],
        slos: [],
      },
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
    expect(sloReconciler).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false }),
    );
  });

  it("rejects resources placed under the wrong state key", async () => {
    try {
      await applyResources({
        orgId: "org-1",
        repoid: "repo-1",
        state: {
          dashboards: [{ path: "alert.yaml", resource: { kind: "AlertRule" } }],
          runbooks: [],
          alerts: [],
          slos: [],
        },
      });
      expect.fail("expected the misplaced resource to be rejected");
    } catch (error) {
      expect((error as Error).message).toBe(
        'alert.yaml: expected kind "Dashboard"',
      );
    }

    expect(dashboardReconciler).not.toHaveBeenCalled();
    expect(runbookReconciler).not.toHaveBeenCalled();
    expect(alertReconciler).not.toHaveBeenCalled();
  });

  // `Runbook` is canonical and the legacy `Notebook` kind stays accepted per
  // ADR 0002.
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
          slos: [],
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
    try {
      await applyResources({
        orgId: "org-1",
        repoid: "repo-1",
        state: {
          dashboards: [{ path: "nb.yaml", resource: { kind: "Notebook" } }],
          runbooks: [],
          alerts: [],
          slos: [],
        },
      });
      expect.fail(
        "expected the Notebook alias to be rejected under dashboards",
      );
    } catch (error) {
      expect((error as Error).message).toBe(
        'nb.yaml: expected kind "Dashboard"',
      );
    }

    expect(dashboardReconciler).not.toHaveBeenCalled();
    expect(runbookReconciler).not.toHaveBeenCalled();
    expect(alertReconciler).not.toHaveBeenCalled();
  });

  it("passes preview to every reconciler and registers the preview once", async () => {
    await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      preview: "gio/x",
      state: {
        dashboards: [],
        runbooks: [],
        alerts: [],
        slos: [],
      },
    });
    for (const reconciler of [
      dashboardReconciler,
      runbookReconciler,
      alertReconciler,
      sloReconciler,
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
    // Registered on the BASE executor, committed before the reconcile
    // transaction opens: the alerting engine-backed kinds write suppressed resources tagged
    // with this id over HTTP, so the row must never be able to roll back out
    // from under them (orphan namespace), and the orphan sweep's "row before
    // resources" invariant must hold mid-apply.
    expect(upsertPreview).toHaveBeenCalledWith(db, {
      orgId: "org-1",
      repoid: "repo-1",
      name: "gio/x",
    });
    const registeredAt = upsertPreview.mock.invocationCallOrder[0];
    const txOpenedAt = vi.mocked(db.transaction).mock.invocationCallOrder[0];
    expect(registeredAt).toBeLessThan(txOpenedAt);
  });

  it("keeps the preview registered when a kind fails mid-apply (no orphan namespace)", async () => {
    // Validation (dry-run) pass succeeds; the real pass fails on the SLO kind,
    // after the alert kind already wrote to alerting engine.
    sloReconciler
      .mockResolvedValueOnce(empty)
      .mockRejectedValueOnce(new Error("cc unavailable"));

    await expect(
      applyResources({
        orgId: "org-1",
        repoid: "repo-1",
        preview: "gio/x",
        state: { dashboards: [], runbooks: [], alerts: [], slos: [] },
      }),
    ).rejects.toThrow("cc unavailable");

    // Registration committed on the base executor before the failing
    // transaction, so the suppressed alerting engine rules the alert kind created stay
    // under a REGISTERED namespace: the next apply converges them and the
    // orphan sweep never reaps a live preview.
    expect(upsertPreview).toHaveBeenCalledTimes(1);
    expect(upsertPreview).toHaveBeenCalledWith(db, {
      orgId: "org-1",
      repoid: "repo-1",
      name: "gio/x",
    });
  });

  it("does not register a preview for live or dry-run applies", async () => {
    await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      state: {
        dashboards: [],
        runbooks: [],
        alerts: [],
        slos: [],
      },
    });
    await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      preview: "gio/x",
      dryRun: true,
      state: {
        dashboards: [],
        runbooks: [],
        alerts: [],
        slos: [],
      },
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
    try {
      await applyResources({
        orgId: "org-1",
        repoid: "repo-1",
        state: {
          dashboards: [{ path: "d.yaml", resource: { kind: "Dashboard" } }],
          runbooks: [],
          alerts: [],
          slos: [],
        },
        dryRun: false,
      });
      expect.fail("expected the ownership conflict to fail the apply");
    } catch (error) {
      expect((error as Error).message).toMatch(
        /default\/cpu \(owned by repo-2\)[\s\S]*--adopt/,
      );
    }
    // Fail-fast: aborts in the validation pass, before the real apply's
    // transaction ever registers or writes.
    expect(upsertPreview).not.toHaveBeenCalled();
  });

  it("passes adopt through to every reconciler", async () => {
    await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      adopt: true,
      state: {
        dashboards: [],
        runbooks: [],
        alerts: [],
        slos: [],
      },
    });
    expect(dashboardReconciler).toHaveBeenCalledWith(
      expect.objectContaining({ adopt: true }),
    );
    expect(alertReconciler).toHaveBeenCalledWith(
      expect.objectContaining({ adopt: true }),
    );
    expect(sloReconciler).toHaveBeenCalledWith(
      expect.objectContaining({ adopt: true }),
    );
  });

  it("appends orphan-link warnings to the Runbook kind's result note, joined with its existing note", async () => {
    runbookReconciler.mockResolvedValue({
      created: [],
      updated: [],
      deleted: ["triage"],
      adopted: [],
      conflicts: [],
      note: "preview-only advisory",
    });
    collectOrphanWarnings.mockResolvedValue([
      'deleting runbook "default/triage" orphans the link from alert "default/api-errors" (owned by repo-2)',
    ]);
    const out = await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      state: { dashboards: [], runbooks: [], alerts: [], slos: [] },
      dryRun: false,
    });
    expect(collectOrphanWarnings).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: expect.objectContaining({ kind: "live" }),
      }),
    );
    const runbookResult = out.results.find((r) => r.kind === "Runbook");
    expect(runbookResult?.note).toBe(
      'preview-only advisory; deleting runbook "default/triage" orphans the link from alert "default/api-errors" (owned by repo-2)',
    );
  });

  it("appends orphan-link warnings to the dry-run result too", async () => {
    runbookReconciler.mockResolvedValue({
      created: [],
      updated: [],
      deleted: ["triage"],
      adopted: [],
      conflicts: [],
    });
    collectOrphanWarnings.mockResolvedValue([
      'deleting runbook "default/triage" orphans the link from slo "default/checkout" (owned by repo-2)',
    ]);
    const out = await applyResources({
      orgId: "org-1",
      repoid: "repo-1",
      state: { dashboards: [], runbooks: [], alerts: [], slos: [] },
      dryRun: true,
    });
    const runbookResult = out.results.find((r) => r.kind === "Runbook");
    expect(runbookResult?.note).toBe(
      'deleting runbook "default/triage" orphans the link from slo "default/checkout" (owned by repo-2)',
    );
  });
});
