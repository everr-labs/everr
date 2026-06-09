import { beforeEach, describe, expect, it, vi } from "vitest";

const dashboardReconciler = vi.fn();
vi.mock("@/data/dashboards/apply.server", () => ({
  applyDashboardSpecs: (...a: unknown[]) => dashboardReconciler(...a),
}));

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
});

describe("applyResources", () => {
  it("routes Dashboard docs to the dashboard reconciler and returns a per-kind summary", async () => {
    dashboardReconciler.mockResolvedValueOnce({
      created: ["cpu"],
      updated: [],
      deleted: [],
      dryRun: false,
    });
    const out = await applyResources({
      orgId: "org-1",
      documents: [doc("Dashboard", "cpu")],
      dryRun: false,
    });
    expect(dashboardReconciler).toHaveBeenCalledWith({
      orgId: "org-1",
      documents: [doc("Dashboard", "cpu")],
      dryRun: false,
    });
    expect(out).toEqual({
      dryRun: false,
      results: [
        { kind: "Dashboard", created: ["cpu"], updated: [], deleted: [] },
      ],
    });
  });

  it("reconciles every registered kind even when absent from the tree (prunes)", async () => {
    await applyResources({
      orgId: "org-1",
      documents: [],
      dryRun: false,
    });
    expect(dashboardReconciler).toHaveBeenCalledWith({
      orgId: "org-1",
      documents: [],
      dryRun: false,
    });
  });

  it("throws on a document missing a string kind", async () => {
    await expect(
      applyResources({
        orgId: "org-1",
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
        documents: [doc(kind, "x")],
        dryRun: false,
      }),
    ).rejects.toThrow(new RegExp(`unknown kind "${kind}"`));
    expect(dashboardReconciler).not.toHaveBeenCalled();
  });
});
