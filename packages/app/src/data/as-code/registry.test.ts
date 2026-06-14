import { beforeEach, describe, expect, it, vi } from "vitest";

const dashboardReconciler = vi.fn();
vi.mock("@/data/dashboards/apply.server", () => ({
  applyDashboardSpecs: (...a: unknown[]) => dashboardReconciler(...a),
}));

const notebookReconciler = vi.fn();
vi.mock("@/data/notebooks/apply.server", () => ({
  applyNotebookSpecs: (...a: unknown[]) => notebookReconciler(...a),
}));

import { ApplyValidationError } from "./errors";
import { applyResources } from "./registry";

const doc = (kind: string, name: string) => ({
  path: `${name}.yaml`,
  document: { kind, metadata: { name }, spec: { panels: {}, layouts: [] } },
});

beforeEach(() => {
  vi.clearAllMocks();
  dashboardReconciler.mockResolvedValue({
    created: [],
    updated: [],
    deleted: [],
    dryRun: false,
  });
  notebookReconciler.mockResolvedValue({
    created: [],
    updated: [],
    deleted: [],
    dryRun: false,
  });
});

describe("applyResources", () => {
  it("routes Dashboard docs to the dashboard reconciler and returns a per-kind summary", async () => {
    dashboardReconciler.mockResolvedValue({
      created: ["cpu"],
      updated: [],
      deleted: [],
      dryRun: false,
    });
    const out = await applyResources({
      orgId: "org-1",
      projects: ["default"],
      documents: [doc("Dashboard", "cpu")],
      dryRun: false,
    });
    expect(dashboardReconciler).toHaveBeenCalledWith({
      orgId: "org-1",
      projects: ["default"],
      documents: [doc("Dashboard", "cpu")],
      dryRun: false,
    });
    expect(out).toEqual({
      dryRun: false,
      results: [
        { kind: "Dashboard", created: ["cpu"], updated: [], deleted: [] },
        { kind: "Notebook", created: [], updated: [], deleted: [] },
      ],
    });
  });

  it("routes Notebook docs to the notebook reconciler and returns a per-kind summary", async () => {
    notebookReconciler.mockResolvedValue({
      created: ["runbook"],
      updated: [],
      deleted: [],
      dryRun: false,
    });
    const out = await applyResources({
      orgId: "org-1",
      projects: ["default"],
      documents: [doc("Notebook", "runbook")],
      dryRun: false,
    });
    expect(notebookReconciler).toHaveBeenCalledWith({
      orgId: "org-1",
      projects: ["default"],
      documents: [doc("Notebook", "runbook")],
      dryRun: false,
    });
    expect(out.results).toContainEqual({
      kind: "Notebook",
      created: ["runbook"],
      updated: [],
      deleted: [],
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
        projects: ["default"],
        documents: [doc("Dashboard", "cpu"), doc("Notebook", "bad")],
        dryRun: false,
      }),
    ).rejects.toThrow(/bad notebook/);

    // Dashboard was only ever validated (dryRun: true) — never applied for real,
    // so it cannot have pruned the project before Notebook validation threw.
    expect(dashboardReconciler).not.toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false }),
    );
  });

  it("reconciles every registered kind even when absent from the tree (prunes)", async () => {
    await applyResources({
      orgId: "org-1",
      projects: ["default"],
      documents: [],
      dryRun: false,
    });
    expect(dashboardReconciler).toHaveBeenCalledWith({
      orgId: "org-1",
      projects: ["default"],
      documents: [],
      dryRun: false,
    });
  });

  it("throws on a document missing a string kind", async () => {
    await expect(
      applyResources({
        orgId: "org-1",
        projects: ["default"],
        documents: [
          { path: "bad.yaml", document: { metadata: { name: "x" } } },
        ],
        dryRun: false,
      }),
    ).rejects.toThrow(/bad\.yaml.*kind/i);
  });

  it("throws on an unknown kind", async () => {
    await expect(
      applyResources({
        orgId: "org-1",
        projects: ["default"],
        documents: [doc("Gizmo", "x")],
        dryRun: false,
      }),
    ).rejects.toThrow(/unknown kind "Gizmo".*x\.yaml/i);
  });

  it.each([
    "constructor",
    "toString",
    "hasOwnProperty",
    "__proto__",
  ])("rejects the inherited Object property %p as an unknown kind and reconciles nothing", async (kind) => {
    // `kind in REGISTRY` would accept these (prototype chain); an own-property
    // check must not. They must throw BEFORE any reconciler runs — otherwise a
    // doc with such a kind is dropped while Dashboard still prunes the project.
    await expect(
      applyResources({
        orgId: "org-1",
        projects: ["default"],
        documents: [doc(kind, "x")],
        dryRun: false,
      }),
    ).rejects.toThrow(new RegExp(`unknown kind "${kind}"`));
    expect(dashboardReconciler).not.toHaveBeenCalled();
  });
});
