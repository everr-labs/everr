// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/alerting/repository", () => ({
  listAllRules: vi.fn(),
  deleteRule: vi.fn(),
  adoptRule: vi.fn(),
  listSlos: vi.fn(),
  deleteSlo: vi.fn(),
  adoptSlo: vi.fn(),
}));

// These tests exercise repository-backed resources, so db can be a stub.
vi.mock("@/db/client", () => ({ db: {} }));

import * as alerting from "@/data/alerting/repository";
import {
  adoptResource,
  deleteResource,
  getResource,
  isResourceKind,
  listResources,
} from "./resource-admin.server";

const mockedListSlos = vi.mocked(alerting.listSlos);
const mockedDeleteSlo = vi.mocked(alerting.deleteSlo);
const mockedAdoptSlo = vi.mocked(alerting.adoptSlo);

const SQL =
  "SELECT countIf(ok) AS good, count() AS valid FROM t " +
  "WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}";

function alertingSlo(
  name: string,
  repoid: string,
  over: Record<string, unknown> = {},
) {
  return {
    id: `slo-${name.split("/").pop()}`,
    tenant: "t",
    repoid,
    previewId: null,
    name,
    version: 4,
    paused: false,
    updated_at: "2026-07-01T00:00:00Z",
    budget_epoch: "2026-07-01T00:00:00Z",
    spec: {
      sli: { sql: SQL },
      targetPercent: 99.9,
      timeWindow: { duration: "30d", isRolling: true },
      annotations: {},
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
  it("lists live SLOs with their first-class owner and updated_at", async () => {
    mockedListSlos.mockResolvedValue([
      alertingSlo("payments/checkout", "repo-1"),
      alertingSlo("default/hand-made", "repo-ui"),
      // Preview copy: never a live resource.
      alertingSlo("payments/checkout", "repo-1", { previewId: "p1" }),
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
        repoid: "repo-ui",
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ]);
  });

  it("filters by repoid", async () => {
    mockedListSlos.mockResolvedValue([
      alertingSlo("default/mine", "repo-1"),
      alertingSlo("default/theirs", "repo-2"),
      alertingSlo("default/hand-made", "repo-ui"),
    ]);

    const mine = await listResources("org-1", {
      kind: "slo",
      repoid: "repo-1",
    });
    expect(mine.map((r) => r.slug)).toEqual(["mine"]);

    const uiOwned = await listResources("org-1", {
      kind: "slo",
      repoid: "repo-ui",
    });
    expect(uiOwned.map((r) => r.slug)).toEqual(["hand-made"]);
  });

  it("adopts an SLO from another owner", async () => {
    mockedListSlos.mockResolvedValue([
      alertingSlo("default/hand-made", "repo-ui"),
    ]);
    mockedAdoptSlo.mockResolvedValue(
      alertingSlo("default/hand-made", "repo-1"),
    );

    const result = await adoptResource(
      "org-1",
      "slo",
      "default",
      "hand-made",
      "repo-1",
    );

    expect(result).toEqual({ found: true, alreadyOwned: false });
    expect(mockedAdoptSlo).toHaveBeenCalledWith(
      "org-1",
      "slo-hand-made",
      "repo-1",
      4,
    );
  });

  it("reconstructs the canonical kind: SLO document on get", async () => {
    mockedListSlos.mockResolvedValue([alertingSlo("default/checkout", "r")]);

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

  it("deletes the matching SLO", async () => {
    mockedListSlos.mockResolvedValue([alertingSlo("default/checkout", "r")]);

    expect(await deleteResource("org-1", "slo", "default", "checkout")).toBe(
      true,
    );
    expect(mockedDeleteSlo).toHaveBeenCalledWith("org-1", "slo-checkout");

    expect(await deleteResource("org-1", "slo", "default", "nope")).toBe(false);
  });

  it("adopts by updating first-class ownership with a version guard", async () => {
    mockedListSlos.mockResolvedValue([
      alertingSlo("default/checkout", "repo-2"),
    ]);

    const res = await adoptResource(
      "org-1",
      "slo",
      "default",
      "checkout",
      "repo-1",
    );

    expect(res).toEqual({ found: true, alreadyOwned: false });
    const [org, id, repoid, version] = mockedAdoptSlo.mock.calls[0];
    expect(org).toBe("org-1");
    expect(id).toBe("slo-checkout");
    expect(version).toBe(4);
    expect(repoid).toBe("repo-1");
  });

  it("adopt reports alreadyOwned and not-found without writing", async () => {
    mockedListSlos.mockResolvedValue([
      alertingSlo("default/checkout", "repo-1"),
    ]);

    expect(
      await adoptResource("org-1", "slo", "default", "checkout", "repo-1"),
    ).toEqual({ found: true, alreadyOwned: true });
    expect(
      await adoptResource("org-1", "slo", "default", "missing", "repo-1"),
    ).toEqual({ found: false, alreadyOwned: false });
    expect(mockedAdoptSlo).not.toHaveBeenCalled();
  });
});
