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
  RESOURCE_KINDS,
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
    id: `slo-${name}`,
    tenant: "t",
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

  it("RESOURCE_KINDS lists exactly the four kinds", () => {
    expect([...RESOURCE_KINDS]).toEqual([
      "dashboard",
      "runbook",
      "alert",
      "slo",
    ]);
  });
});

describe("slo backend", () => {
  it("lists only live everr-owned SLOs with their CC updated_at", async () => {
    mockedListSlos.mockResolvedValue([
      ccSlo("checkout", {
        "everr.name": "checkout",
        "everr.repoid": "repo-1",
        "everr.project": "payments",
      }),
      // UI-created (no everr.name): not an as-code resource.
      ccSlo("hand-made", {}),
      // Preview copy: never a live resource.
      ccSlo("checkout.pv-0123456789", {
        "everr.name": "checkout",
        "everr.repoid": "repo-1",
        "everr.preview": "p1",
      }),
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
    ]);
  });

  it("filters by repoid", async () => {
    mockedListSlos.mockResolvedValue([
      ccSlo("mine", { "everr.name": "mine", "everr.repoid": "repo-1" }),
      ccSlo("theirs", { "everr.name": "theirs", "everr.repoid": "repo-2" }),
    ]);

    const out = await listResources("org-1", { kind: "slo", repoid: "repo-1" });
    expect(out.map((r) => r.slug)).toEqual(["mine"]);
  });

  it("reconstructs the canonical kind: SLO document on get", async () => {
    mockedListSlos.mockResolvedValue([
      ccSlo("checkout", { "everr.name": "checkout", "everr.repoid": "r" }),
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
      ccSlo("checkout", { "everr.name": "checkout", "everr.repoid": "r" }),
    ]);

    expect(await deleteResource("org-1", "slo", "default", "checkout")).toBe(
      true,
    );
    expect(mockedDeleteSlo).toHaveBeenCalledWith("org-1", "slo-checkout");

    expect(await deleteResource("org-1", "slo", "default", "nope")).toBe(false);
  });

  it("adopts by rewriting everr.repoid via a version-guarded update", async () => {
    mockedListSlos.mockResolvedValue([
      ccSlo("checkout", { "everr.name": "checkout", "everr.repoid": "repo-2" }),
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
    expect(input.name).toBe("checkout");
    expect(input.annotations).toEqual({
      "everr.name": "checkout",
      "everr.repoid": "repo-1",
    });
  });

  it("adopt reports alreadyOwned and not-found without writing", async () => {
    mockedListSlos.mockResolvedValue([
      ccSlo("checkout", { "everr.name": "checkout", "everr.repoid": "repo-1" }),
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
