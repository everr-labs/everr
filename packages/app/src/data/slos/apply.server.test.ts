import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/cc/client", () => ({
  listSlos: vi.fn(),
  createSlo: vi.fn(),
  updateSlo: vi.fn(),
  deleteSlo: vi.fn(),
  testSlo: vi.fn(),
}));

import * as cc from "@/data/cc/client";
import { CcApiError } from "@/data/cc/errors";
import type { DbExecutor } from "@/db/client";
import { applySloSpecs } from "./apply.server";

// The SLO reconciler talks to CC over HTTP and never touches Postgres, so the
// Reconciler contract's `db` is unused here — a stub satisfies the type.
const db = {} as unknown as DbExecutor;

const mockedList = cc.listSlos as ReturnType<typeof vi.fn>;
const mockedCreate = cc.createSlo as ReturnType<typeof vi.fn>;
const mockedUpdate = cc.updateSlo as ReturnType<typeof vi.fn>;
const mockedDelete = cc.deleteSlo as ReturnType<typeof vi.fn>;
const mockedTest = cc.testSlo as ReturnType<typeof vi.fn>;

const NIL_ID = "00000000-0000-0000-0000-000000000000";

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

// A CC SLO view as returned by the listing, matching what applying the default
// sloDoc() fixture stores (so the fingerprints are equal).
function managedSlo(name: string, specOver: Record<string, unknown> = {}) {
  return {
    id: `slo-${name}`,
    tenant: "t",
    name,
    version: 3,
    paused: false,
    updated_at: "2026-07-01T00:00:00Z",
    spec: {
      sli: { sql: SQL, label_columns: ["service"] },
      targetPercent: 99.9,
      timeWindow: { duration: "30d", isRolling: true },
      annotations: { "everr.name": name, "everr.repoid": "repo-1" },
      suppressed: false,
      ...specOver,
    },
  };
}

// A stored PREVIEW copy: suppressed, tagged with its owning preview registry
// id, and registered under a preview-mangled CC name (names are tenant-unique).
function previewSlo(name: string, previewId: string) {
  const base = managedSlo(name);
  return {
    ...base,
    id: `prev-slo-${name}`,
    name: `${name}.pv-0123456789`,
    spec: {
      ...base.spec,
      annotations: { ...base.spec.annotations, "everr.preview": previewId },
      suppressed: true,
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

    // Validation first: CC's dry-run test probe with the nil placeholder id
    // (the SLO does not exist yet; CC ignores the path id).
    expect(mockedTest).toHaveBeenCalledTimes(1);
    const [tOrg, tId, tInput] = mockedTest.mock.calls[0];
    expect(tOrg).toBe("o");
    expect(tId).toBe(NIL_ID);
    expect(tInput.name).toBe("checkout");

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    const [org, input] = mockedCreate.mock.calls[0];
    expect(org).toBe("o");
    expect(input.name).toBe("checkout");
    expect(input.annotations["everr.name"]).toBe("checkout");
    expect(input.annotations["everr.repoid"]).toBe("repo-1");
    expect(input.suppressed).toBe(false);
    expect(input.sli).toEqual({ sql: SQL, label_columns: ["service"] });
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedDelete).not.toHaveBeenCalled();
    expect(res.created).toEqual(["checkout"]);
    expect(res.note).toBeUndefined();
  });

  it("dry-run validates through the test probe but never mutates", async () => {
    const res = await applySloSpecs({
      namespace: live,
      db,
      dryRun: true,
      resources: [{ path: "s.yaml", resource: sloDoc() }],
    });

    expect(res).toEqual({
      created: ["checkout"],
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

  it("preview apply creates a suppressed SLO under a mangled name, tagged with the preview id", async () => {
    const res = await applySloSpecs({
      namespace: { ...live, kind: "preview", id: "p1" },
      db,
      resources: [{ path: "s.yaml", resource: sloDoc() }],
    });

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    const [, input] = mockedCreate.mock.calls[0];
    // CC SLO names are tenant-unique, so the preview copy cannot reuse the
    // live name: it gets a deterministic per-(preview, name) suffix.
    expect(input.name).toMatch(/^checkout\.pv-[0-9a-f]{10}$/);
    expect(input.suppressed).toBe(true);
    expect(input.annotations["everr.preview"]).toBe("p1");
    expect(input.annotations["everr.name"]).toBe("checkout");
    expect(res.created).toEqual(["checkout"]);
    expect(res.note).toMatch(/suppressed/);
  });

  it("scopes a preview reconcile to SLOs tagged with ITS preview id", async () => {
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

    expect(res.deleted).toEqual(["stale"]);
    expect(mockedDelete).toHaveBeenCalledTimes(1);
    expect(mockedDelete).toHaveBeenCalledWith("o", "prev-slo-stale");
  });

  it("updates a preview SLO in place (matched by annotation, not CC name)", async () => {
    mockedList.mockResolvedValue([previewSlo("checkout", "p1")]);

    const res = await applySloSpecs({
      namespace: { ...live, kind: "preview", id: "p1" },
      db,
      resources: [{ path: "s.yaml", resource: sloDoc() }],
    });

    // The stored preview name differs from the freshly mangled one, so the
    // SLO converges via a version-guarded update — never delete + recreate.
    expect(res.created).toEqual([]);
    expect(res.updated).toEqual(["checkout"]);
    expect(mockedCreate).not.toHaveBeenCalled();
    const [, id, input, version] = mockedUpdate.mock.calls[0];
    expect(id).toBe("prev-slo-checkout");
    expect(version).toBe(3);
    expect(input.suppressed).toBe(true);
    expect(input.annotations["everr.preview"]).toBe("p1");
  });

  it("dry-run of a first preview apply (no registry row) plans creates without listing CC", async () => {
    const res = await applySloSpecs({
      namespace: { ...live, kind: "preview", id: null },
      db,
      dryRun: true,
      resources: [{ path: "s.yaml", resource: sloDoc() }],
    });

    expect(res.created).toEqual(["checkout"]);
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

    expect(res.updated).toEqual(["checkout"]);
    // Changed specs are re-validated against the existing SLO's id.
    expect(mockedTest).toHaveBeenCalledTimes(1);
    expect(mockedTest.mock.calls[0][1]).toBe("slo-checkout");
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    const [org, id, input, version] = mockedUpdate.mock.calls[0];
    expect(org).toBe("o");
    expect(id).toBe("slo-checkout");
    expect(version).toBe(3);
    expect(input.targetPercent).toBe(99.9);
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
        /s\.yaml: SLO "checkout" was modified concurrently .* re-run apply/,
      ),
    });
  });

  it("deletes a managed SLO absent from config", async () => {
    mockedList.mockResolvedValue([managedSlo("gone")]);

    const res = await applySloSpecs({ namespace: live, db, resources: [] });

    expect(mockedDelete).toHaveBeenCalledWith("o", "slo-gone");
    expect(res.deleted).toEqual(["gone"]);
  });

  it("never deletes a bare engine SLO (no everr.name) or another repo's SLO", async () => {
    mockedList.mockResolvedValue([
      {
        ...managedSlo("ui-made"),
        spec: { ...managedSlo("ui-made").spec, annotations: {} },
      },
      managedSlo("elsewhere", {
        annotations: { "everr.name": "elsewhere", "everr.repoid": "repo-2" },
      }),
    ]);

    const res = await applySloSpecs({ namespace: live, db, resources: [] });

    expect(mockedDelete).not.toHaveBeenCalled();
    expect(res.deleted).toEqual([]);
  });

  it("reports a cross-repo name collision as an ownership conflict (no writes)", async () => {
    mockedList.mockResolvedValue([
      managedSlo("checkout", {
        annotations: { "everr.name": "checkout", "everr.repoid": "repo-2" },
      }),
    ]);

    const res = await applySloSpecs({
      namespace: live,
      db,
      resources: [{ path: "s.yaml", resource: sloDoc() }],
    });

    expect(res.conflicts).toEqual([
      { project: "default", slug: "checkout", owner: "repo-2" },
    ]);
    expect(res.created).toEqual([]);
    expect(res.adopted).toEqual([]);
    // Conflicted creates are neither validated nor written: the registry
    // aborts the whole apply on the reported conflicts.
    expect(mockedTest).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('reports a UI-created SLO name collision with owner ""', async () => {
    const bare = managedSlo("checkout");
    mockedList.mockResolvedValue([
      { ...bare, spec: { ...bare.spec, annotations: {} } },
    ]);

    const res = await applySloSpecs({
      namespace: live,
      db,
      resources: [{ path: "s.yaml", resource: sloDoc() }],
    });

    expect(res.conflicts).toEqual([
      { project: "default", slug: "checkout", owner: "" },
    ]);
  });

  it("adopts a colliding foreign SLO in place with adopt: true", async () => {
    mockedList.mockResolvedValue([
      managedSlo("checkout", {
        annotations: { "everr.name": "checkout", "everr.repoid": "repo-2" },
      }),
    ]);

    const res = await applySloSpecs({
      namespace: live,
      db,
      adopt: true,
      resources: [{ path: "s.yaml", resource: sloDoc() }],
    });

    expect(res.conflicts).toEqual([]);
    expect(res.adopted).toEqual(["checkout"]);
    expect(res.created).toEqual([]);
    // Ownership transfers via a version-guarded update on the existing id, so
    // the SLO's id and instance state survive the takeover.
    expect(mockedCreate).not.toHaveBeenCalled();
    const [, id, input, version] = mockedUpdate.mock.calls[0];
    expect(id).toBe("slo-checkout");
    expect(version).toBe(3);
    expect(input.annotations["everr.repoid"]).toBe("repo-1");
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
        /duplicate SLO "same" \(a\.yaml and b\.yaml\)/,
      ),
    });

    expect(mockedList).not.toHaveBeenCalled();
    expect(mockedTest).not.toHaveBeenCalled();
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
});
