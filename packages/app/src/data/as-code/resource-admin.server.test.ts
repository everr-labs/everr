// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/cc/client", () => ({
  listAllRules: vi.fn(),
  deleteRule: vi.fn(),
  updateRule: vi.fn(),
  listSlos: vi.fn(),
  deleteSlo: vi.fn(),
  updateSlo: vi.fn(),
}));

// The Postgres-backed kinds are exercised through their routes; these unit
// tests only drive the CC-backed slo backend, so `db` can be a stub.
vi.mock("@/db/client", () => ({ db: {} }));

import * as cc from "@/data/cc/client";
import {
  adoptResource,
  deleteResource,
  getResource,
  isResourceKind,
  listResources,
} from "./resource-admin.server";

const mockedListSlos = vi.mocked(cc.listSlos);
const mockedDeleteSlo = vi.mocked(cc.deleteSlo);
const mockedUpdateSlo = vi.mocked(cc.updateSlo);

const SQL =
  "SELECT countIf(ok) AS good, count() AS valid FROM t " +
  "WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}";

function ccSlo(
  name: string,
  annotations: Record<string, string>,
  over: Record<string, unknown> = {},
) {
  return {
    id: `slo-${name.split("/").pop()}`,
    tenant: "t",
    namespace: "",
    name,
    version: 4,
    paused: false,
    updated_at: "2026-07-01T00:00:00Z",
    budget_epoch: "2026-07-01T00:00:00Z",
    spec: {
      sli: { sql: SQL, label_columns: [] },
      targetPercent: 99.9,
      timeWindow: { duration: "30d", isRolling: true },
      annotations,
      suppressed: false,
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedListSlos.mockResolvedValue([]);
  mockedDeleteSlo.mockResolvedValue({ deleted: true });
});

describe("isResourceKind", () => {
  it("accepts the four kinds", () => {
    expect(isResourceKind("dashboard")).toBe(true);
    expect(isResourceKind("runbook")).toBe(true);
    expect(isResourceKind("alert")).toBe(true);
    expect(isResourceKind("slo")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isResourceKind("Dashboard")).toBe(false);
    expect(isResourceKind("alertrule")).toBe(false);
    expect(isResourceKind("SLO")).toBe(false);
    expect(isResourceKind("")).toBe(false);
  });
});

describe("slo backend", () => {
  it("lists live SLOs, unowned included, with their CC updated_at", async () => {
    mockedListSlos.mockResolvedValue([
      ccSlo("payments/checkout", { "everr.repoid": "repo-1" }),
      // Engine/UI-created (no everr.repoid): listed as unowned (repoid ""),
      // like the Postgres-backed kinds, so it can be found and adopted.
      ccSlo("hand-made", {}),
      // Preview copy: never a live resource.
      ccSlo(
        "payments/checkout",
        { "everr.repoid": "repo-1" },
        { namespace: "p1" },
      ),
    ]);

    const out = await listResources("org-1", { kind: "slo" });

    expect(out).toEqual([
      {
        kind: "slo",
        project: "payments",
        slug: "checkout",
        repoid: "repo-1",
        updatedAt: "2026-07-01T00:00:00Z",
      },
      {
        kind: "slo",
        project: "default",
        slug: "hand-made",
        repoid: "",
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ]);
  });

  it('filters by repoid, with "" selecting unowned rows', async () => {
    mockedListSlos.mockResolvedValue([
      ccSlo("default/mine", { "everr.repoid": "repo-1" }),
      ccSlo("default/theirs", { "everr.repoid": "repo-2" }),
      ccSlo("default/hand-made", {}),
    ]);

    const mine = await listResources("org-1", {
      kind: "slo",
      repoid: "repo-1",
    });
    expect(mine.map((r) => r.slug)).toEqual(["mine"]);

    const unowned = await listResources("org-1", { kind: "slo", repoid: "" });
    expect(unowned.map((r) => r.slug)).toEqual(["hand-made"]);
  });

  it("adopts an unowned SLO into a repo", async () => {
    mockedListSlos.mockResolvedValue([ccSlo("default/hand-made", {})]);
    mockedUpdateSlo.mockResolvedValue(ccSlo("default/hand-made", {}));

    const result = await adoptResource(
      "org-1",
      "slo",
      "default",
      "hand-made",
      "repo-1",
    );

    expect(result).toEqual({ found: true, alreadyOwned: false });
    expect(mockedUpdateSlo).toHaveBeenCalledWith(
      "org-1",
      "slo-hand-made",
      expect.objectContaining({
        annotations: expect.objectContaining({ "everr.repoid": "repo-1" }),
      }),
      4,
    );
  });

  it("reconstructs the canonical kind: SLO document on get", async () => {
    mockedListSlos.mockResolvedValue([
      ccSlo("default/checkout", { "everr.repoid": "r" }),
    ]);

    const doc = await getResource("org-1", "slo", "default", "checkout");
    expect(doc).toMatchObject({
      kind: "SLO",
      metadata: { name: "checkout" },
      spec: { targetPercent: 99.9, timeWindow: "30d" },
    });

    expect(await getResource("org-1", "slo", "default", "nope")).toBeNull();
    // Addressing is (project, slug): the wrong project misses.
    expect(
      await getResource("org-1", "slo", "payments", "checkout"),
    ).toBeNull();
  });

  it("deletes the matching CC SLO", async () => {
    mockedListSlos.mockResolvedValue([
      ccSlo("default/checkout", { "everr.repoid": "r" }),
    ]);

    expect(await deleteResource("org-1", "slo", "default", "checkout")).toBe(
      true,
    );
    expect(mockedDeleteSlo).toHaveBeenCalledWith("org-1", "slo-checkout");

    expect(await deleteResource("org-1", "slo", "default", "nope")).toBe(false);
  });

  it("adopts by rewriting everr.repoid via a version-guarded update", async () => {
    mockedListSlos.mockResolvedValue([
      ccSlo("default/checkout", { "everr.repoid": "repo-2" }),
    ]);

    const res = await adoptResource(
      "org-1",
      "slo",
      "default",
      "checkout",
      "repo-1",
    );

    expect(res).toEqual({ found: true, alreadyOwned: false });
    const [org, id, input, version] = mockedUpdateSlo.mock.calls[0];
    expect(org).toBe("org-1");
    expect(id).toBe("slo-checkout");
    expect(version).toBe(4);
    // Spec-only update body: no `name` field (CcSloUpdate is CcSloSpecSchema).
    expect(input).not.toHaveProperty("name");
    expect(input.annotations).toEqual({
      "everr.repoid": "repo-1",
    });
  });

  it("adopt reports alreadyOwned and not-found without writing", async () => {
    mockedListSlos.mockResolvedValue([
      ccSlo("default/checkout", { "everr.repoid": "repo-1" }),
    ]);

    expect(
      await adoptResource("org-1", "slo", "default", "checkout", "repo-1"),
    ).toEqual({ found: true, alreadyOwned: true });
    expect(
      await adoptResource("org-1", "slo", "default", "missing", "repo-1"),
    ).toEqual({ found: false, alreadyOwned: false });
    expect(mockedUpdateSlo).not.toHaveBeenCalled();
  });
});
