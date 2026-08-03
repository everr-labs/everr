import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/cc/client", () => ({
  listSlos: vi.fn(),
  createSlo: vi.fn(),
  updateSlo: vi.fn(),
  deleteSlo: vi.fn(),
  testSlo: vi.fn(),
}));

// The reconciler builds absolute runbook links from the app origin; tests
// must not depend on real (validated) server env.
vi.mock("@/env/auth", () => ({
  authEnv: { BETTER_AUTH_URL: "https://app.example.com" },
}));

import * as cc from "@/data/cc/client";
import { CcApiError } from "@/data/cc/errors";
import type { DbExecutor } from "@/db/client";
import { applySloSpecs } from "./apply.server";
import { OWN_REPO } from "./mapping";

// The SLO reconciler talks to CC over HTTP and never touches Postgres, so the
// Reconciler contract's `db` is unused here — a stub satisfies the type.
const db = {} as unknown as DbExecutor;

const mockedList = cc.listSlos as ReturnType<typeof vi.fn>;
const mockedCreate = cc.createSlo as ReturnType<typeof vi.fn>;
const mockedUpdate = cc.updateSlo as ReturnType<typeof vi.fn>;
const mockedDelete = cc.deleteSlo as ReturnType<typeof vi.fn>;
const mockedTest = cc.testSlo as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedList.mockResolvedValue([]);
  mockedTest.mockResolvedValue({ matched: 1, groups: [] });
  mockedCreate.mockResolvedValue({ id: "new-slo", version: 1 });
  mockedUpdate.mockResolvedValue({ id: "new-slo", version: 2 });
  mockedDelete.mockResolvedValue({ deleted: true });
});

const SQL =
  "SELECT countIf(ok) AS good, count() AS valid FROM t " +
  "WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}";

function sloDoc(name = "checkout", overrides = {}) {
  return {
    kind: "SLO",
    metadata: { name },
    spec: {
      sli: { sql: SQL, labelColumns: ["service"] },
      targetPercent: 99.9,
      timeWindow: "30d",
      ...overrides,
    },
  };
}

// A CC SLO view shape as returned by the listing, matching what applying the
// default sloDoc() fixture stores (so the fingerprints are equal). Identity
// (project/slug, live-vs-preview) lives on the SLO's first-class `name`/
// `namespace` fields now, not an annotation — only everr.repoid stays there.
function managedSlo(name: string, specOver: Record<string, unknown> = {}) {
  return {
    id: `slo-${name}`,
    tenant: "t",
    namespace: "",
    name: `default/${name}`,
    version: 3,
    paused: false,
    updated_at: "2026-07-01T00:00:00Z",
    spec: {
      sli: { sql: SQL, label_columns: ["service"] },
      targetPercent: 99.9,
      timeWindow: { duration: "30d", isRolling: true },
      annotations: { [OWN_REPO]: "repo-1" },
      suppressed: false,
      ...specOver,
    },
  };
}

// A stored PREVIEW copy: suppressed, tagged with its owning preview registry
// id on the first-class `namespace` field. The project/slug `name` is
// unchanged from the live copy — CC SLO names are unique per (tenant,
// namespace), so no CC-name mangling is needed.
function previewSlo(
  name: string,
  previewId: string,
  over: Record<string, unknown> = {},
) {
  const base = managedSlo(name);
  return {
    ...base,
    id: `prev-slo-${name}`,
    namespace: previewId,
    spec: {
      ...base.spec,
      suppressed: true,
      ...over,
    },
  };
}

const live = { orgId: "o", repoid: "repo-1", kind: "live" } as const;

describe("applySloSpecs", () => {
  it("creates a managed CC SLO after validating the spec through the test probe", async () => {
    const res = await applySloSpecs({
      namespace: live,
      db,
      resources: [{ path: "s.yaml", resource: sloDoc() }],
    });

    // Validation first: CC's dry-run test probe takes the bare spec (nothing
    // is written, so no identity is needed).
    expect(mockedTest).toHaveBeenCalledTimes(1);
    const [tOrg, tSpec] = mockedTest.mock.calls[0];
    expect(tOrg).toBe("o");
    expect(tSpec.targetPercent).toBe(99.9);
    expect(tSpec.name).toBeUndefined();

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    const [org, input] = mockedCreate.mock.calls[0];
    expect(org).toBe("o");
    expect(input.name).toBe("default/checkout");
    expect(input.namespace).toBe("");
    expect(input.annotations[OWN_REPO]).toBe("repo-1");
    expect(input.suppressed).toBe(false);
    expect(input.sli).toEqual({ sql: SQL, label_columns: ["service"] });
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedDelete).not.toHaveBeenCalled();
    expect(res.created).toEqual(["default/checkout"]);
  });

  it("dry-run validates through the test probe but never mutates", async () => {
    const res = await applySloSpecs({
      namespace: live,
      db,
      dryRun: true,
      resources: [{ path: "s.yaml", resource: sloDoc() }],
    });

    expect(res).toEqual({
      created: ["default/checkout"],
      updated: [],
      deleted: [],
      adopted: [],
      conflicts: [],
    });
    expect(mockedTest).toHaveBeenCalledTimes(1);
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it("preview apply creates a suppressed SLO in the preview namespace, with the SAME name as live", async () => {
    const res = await applySloSpecs({
      namespace: { ...live, kind: "preview", id: "p1" },
      db,
      resources: [{ path: "s.yaml", resource: sloDoc() }],
    });

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    const [, input] = mockedCreate.mock.calls[0];
    // CC SLO names are unique per (tenant, namespace), so the preview copy
    // reuses the live name under its own namespace: no CC-name mangling.
    expect(input.name).toBe("default/checkout");
    expect(input.namespace).toBe("p1");
    expect(input.suppressed).toBe(true);
    expect(input.annotations[OWN_REPO]).toBe("repo-1");
    expect(res.created).toEqual(["default/checkout"]);
    expect(res.note).toMatch(/suppressed/);
  });

  it("scopes a preview reconcile to SLOs tagged with ITS preview namespace", async () => {
    mockedList.mockResolvedValue([
      // Live SLO in the same repo: invisible to the preview reconcile.
      managedSlo("checkout"),
      // This preview's SLO, absent from config: pruned.
      previewSlo("stale", "p1"),
      // Another preview's SLO: never touched.
      previewSlo("other", "p2"),
    ]);

    const res = await applySloSpecs({
      namespace: { ...live, kind: "preview", id: "p1" },
      db,
      resources: [],
    });

    expect(res.deleted).toEqual(["default/stale"]);
    expect(mockedDelete).toHaveBeenCalledTimes(1);
    expect(mockedDelete).toHaveBeenCalledWith("o", "prev-slo-stale");
  });

  it("leaves an unchanged preview SLO alone and updates a changed one in place", async () => {
    mockedList.mockResolvedValue([previewSlo("checkout", "p1")]);
    const unchanged = await applySloSpecs({
      namespace: { ...live, kind: "preview", id: "p1" },
      db,
      resources: [{ path: "s.yaml", resource: sloDoc() }],
    });
    expect(unchanged.created).toEqual([]);
    expect(unchanged.updated).toEqual([]);
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();

    mockedList.mockResolvedValue([
      previewSlo("checkout", "p1", { targetPercent: 99.5 }),
    ]);
    const changed = await applySloSpecs({
      namespace: { ...live, kind: "preview", id: "p1" },
      db,
      resources: [{ path: "s.yaml", resource: sloDoc() }],
    });

    expect(changed.created).toEqual([]);
    expect(changed.updated).toEqual(["default/checkout"]);
    expect(mockedCreate).not.toHaveBeenCalled();
    const [, id, spec, version] = mockedUpdate.mock.calls[0];
    expect(id).toBe("prev-slo-checkout");
    expect(version).toBe(3);
    expect(spec.suppressed).toBe(true);
    expect(spec.annotations[OWN_REPO]).toBe("repo-1");
  });

  it("dry-run of a first preview apply (no registry row) plans creates without listing CC", async () => {
    const res = await applySloSpecs({
      namespace: { ...live, kind: "preview", id: null },
      db,
      dryRun: true,
      resources: [{ path: "s.yaml", resource: sloDoc() }],
    });

    expect(res.created).toEqual(["default/checkout"]);
    expect(mockedList).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("leaves an unchanged managed SLO alone: no mutation, no test probe", async () => {
    mockedList.mockResolvedValue([managedSlo("checkout")]);

    const res = await applySloSpecs({
      namespace: live,
      db,
      resources: [{ path: "s.yaml", resource: sloDoc() }],
    });

    expect(res).toEqual({
      created: [],
      updated: [],
      deleted: [],
      adopted: [],
      conflicts: [],
    });
    // An unchanged spec already passed validation when it was written: the
    // budget-window probe is not re-run for it.
    expect(mockedTest).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it("updates a changed managed SLO in place with its version", async () => {
    mockedList.mockResolvedValue([
      managedSlo("checkout", { targetPercent: 99.5 }),
    ]);

    const res = await applySloSpecs({
      namespace: live,
      db,
      resources: [{ path: "s.yaml", resource: sloDoc() }],
    });

    expect(res.updated).toEqual(["default/checkout"]);
    // Changed specs are re-validated through the test probe before the PUT.
    expect(mockedTest).toHaveBeenCalledTimes(1);
    expect(mockedTest.mock.calls[0][1].targetPercent).toBe(99.9);
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    const [org, id, spec, version] = mockedUpdate.mock.calls[0];
    expect(org).toBe("o");
    expect(id).toBe("slo-checkout");
    expect(version).toBe(3);
    expect(spec.targetPercent).toBe(99.9);
    // PUT takes the bare spec: no name/namespace (identity is immutable).
    expect(spec.name).toBeUndefined();
    expect(spec.namespace).toBeUndefined();
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it("fails the resource clearly when CC reports a version conflict", async () => {
    mockedList.mockResolvedValue([
      managedSlo("checkout", { targetPercent: 99.5 }),
    ]);
    mockedUpdate.mockRejectedValueOnce(
      new CcApiError(409, "conflict", "slo version mismatch"),
    );

    await expect(
      applySloSpecs({
        namespace: live,
        db,
        resources: [{ path: "s.yaml", resource: sloDoc() }],
      }),
    ).rejects.toMatchObject({
      name: "ApplyValidationError",
      message: expect.stringMatching(
        /s\.yaml: SLO "default\/checkout" was modified concurrently .* re-run apply/,
      ),
    });
  });

  it("deletes a managed SLO absent from config", async () => {
    mockedList.mockResolvedValue([managedSlo("gone")]);

    const res = await applySloSpecs({ namespace: live, db, resources: [] });

    expect(mockedDelete).toHaveBeenCalledWith("o", "slo-gone");
    expect(res.deleted).toEqual(["default/gone"]);
  });

  it("never deletes a bare engine SLO (no everr.repoid) or another repo's SLO", async () => {
    mockedList.mockResolvedValue([
      {
        ...managedSlo("ui-made"),
        spec: { ...managedSlo("ui-made").spec, annotations: {} },
      },
      managedSlo("elsewhere", { annotations: { [OWN_REPO]: "repo-2" } }),
    ]);

    const res = await applySloSpecs({ namespace: live, db, resources: [] });

    expect(mockedDelete).not.toHaveBeenCalled();
    expect(res.deleted).toEqual([]);
  });

  it("reports name collisions as ownership conflicts (no writes)", async () => {
    const bare = managedSlo("cart");
    mockedList.mockResolvedValue([
      managedSlo("checkout", { annotations: { [OWN_REPO]: "repo-2" } }),
      // A UI-created SLO carries no everr.repoid, so its owner reads as "".
      { ...bare, spec: { ...bare.spec, annotations: {} } },
    ]);

    const res = await applySloSpecs({
      namespace: live,
      db,
      resources: [
        { path: "s.yaml", resource: sloDoc() },
        { path: "c.yaml", resource: sloDoc("cart") },
      ],
    });

    expect(res.conflicts).toEqual([
      { project: "default", slug: "checkout", owner: "repo-2" },
      { project: "default", slug: "cart", owner: "" },
    ]);
    expect(res.created).toEqual([]);
    expect(res.adopted).toEqual([]);
    // Conflicted creates are neither validated nor written: the registry
    // aborts the whole apply on the reported conflicts.
    expect(mockedTest).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("adopts a colliding foreign SLO in place with adopt: true", async () => {
    mockedList.mockResolvedValue([
      managedSlo("checkout", { annotations: { [OWN_REPO]: "repo-2" } }),
    ]);

    const res = await applySloSpecs({
      namespace: live,
      db,
      adopt: true,
      resources: [{ path: "s.yaml", resource: sloDoc() }],
    });

    expect(res.conflicts).toEqual([]);
    expect(res.adopted).toEqual(["default/checkout"]);
    expect(res.created).toEqual([]);
    // Ownership transfers via a version-guarded update on the existing id, so
    // the SLO's id and instance state survive the takeover.
    expect(mockedCreate).not.toHaveBeenCalled();
    const [, id, spec, version] = mockedUpdate.mock.calls[0];
    expect(id).toBe("slo-checkout");
    expect(version).toBe(3);
    expect(spec.annotations[OWN_REPO]).toBe("repo-1");
  });

  it("rejects duplicate SLO names before listing CC", async () => {
    await expect(
      applySloSpecs({
        namespace: live,
        db,
        resources: [
          { path: "a.yaml", resource: sloDoc("same") },
          { path: "b.yaml", resource: sloDoc("same") },
        ],
      }),
    ).rejects.toMatchObject({
      name: "ApplyValidationError",
      message: expect.stringMatching(
        /duplicate SLO "default\/same" \(a\.yaml and b\.yaml\)/,
      ),
    });

    expect(mockedList).not.toHaveBeenCalled();
    expect(mockedTest).not.toHaveBeenCalled();
  });

  it("keys duplicate detection on project/slug: same slug in two projects is valid", async () => {
    const res = await applySloSpecs({
      namespace: live,
      db,
      resources: [
        {
          path: "a.yaml",
          resource: {
            ...sloDoc("checkout"),
            metadata: { name: "checkout", project: "payments" },
          },
        },
        {
          path: "b.yaml",
          resource: {
            ...sloDoc("checkout"),
            metadata: { name: "checkout", project: "web" },
          },
        },
      ],
    });

    expect(res.created).toEqual(["payments/checkout", "web/checkout"]);
  });

  it("rejects invalid documents with path context", async () => {
    const cases: [string, unknown, RegExp][] = [
      ["bad.yaml", { kind: "SLO" }, /bad\.yaml: invalid SLO/],
      [
        "target.yaml",
        sloDoc("t", { targetPercent: 100 }),
        /target\.yaml: invalid SLO: targetPercent must be > 0 and < 100/,
      ],
      [
        "window.yaml",
        sloDoc("w", { timeWindow: "1M" }),
        /window\.yaml: invalid SLO: invalid window duration "1M"/,
      ],
      [
        "labels.yaml",
        sloDoc("l", { sli: { sql: SQL, labelColumns: ["slo_tier"] } }),
        /labels\.yaml: invalid SLO: .*SLO pipeline injects/,
      ],
    ];
    for (const [path, resource, pattern] of cases) {
      await expect(
        applySloSpecs({ namespace: live, db, resources: [{ path, resource }] }),
      ).rejects.toMatchObject({
        name: "ApplyValidationError",
        message: expect.stringMatching(pattern),
      });
    }
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("wraps a failed test probe as an apply validation error with path context", async () => {
    mockedTest.mockRejectedValueOnce(
      new CcApiError(422, "validation", "query failed: no such table t"),
    );

    await expect(
      applySloSpecs({
        namespace: live,
        db,
        resources: [{ path: "s.yaml", resource: sloDoc() }],
      }),
    ).rejects.toMatchObject({
      name: "ApplyValidationError",
      message: expect.stringMatching(/s\.yaml: query failed: no such table t/),
    });

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it("stamps an absolute link.runbook using the app origin from BETTER_AUTH_URL", async () => {
    const res = await applySloSpecs({
      namespace: live,
      db,
      resources: [
        {
          path: "s.yaml",
          resource: sloDoc("checkout", { runbook: "checkout-triage" }),
        },
      ],
    });

    expect(res.created).toEqual(["default/checkout"]);
    const [, input] = mockedCreate.mock.calls[0];
    expect(input.annotations["everr.runbook"]).toBe("checkout-triage");
    expect(input.annotations["link.runbook"]).toBe(
      "https://app.example.com/runbooks/default/checkout-triage",
    );
  });
});
