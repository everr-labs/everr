// The slug-addressed rule/SLO by-name lookups: exact-match against the
// qualified "project/slug" name, with a bare-slug fallback for engine-native
// and migration-backfilled resources that never got the qualified name.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CcRuleView, CcSlo } from "@/data/cc/types";
import { getCcRuleByName, getCcSloByName } from "./server";

const mocks = vi.hoisted(() => ({
  listRulesPage: vi.fn(),
  listSlos: vi.fn(),
}));

// The CC client is the fns' only data plane; mocking it at the module
// boundary leaves the fallback logic real.
vi.mock("./client", () => ({
  listRulesPage: mocks.listRulesPage,
  listSlos: mocks.listSlos,
}));

// server.ts also imports the preview-repoid resolver (unused by the by-name
// lookups under test), which pulls in the Postgres client and its server-only
// env at module load; stub it out so importing "./server" doesn't reach it.
vi.mock("@/data/previews/repoids", () => ({
  getPreviewScopes: vi.fn(),
  getCoveredRepoids: vi.fn(),
}));

function ccRule(overrides: { id?: string; name: string }): CcRuleView {
  return {
    id: overrides.id ?? "44444444-4444-4444-4444-444444444444",
    tenant: "org1",
    namespace: "",
    name: overrides.name,
    spec: {
      sql: "SELECT 1",
      interval_secs: 60,
      for_secs: 0,
      label_columns: [],
      severity: "critical",
      annotations: {},
      resolve_after: 1,
      suppressed: false,
    },
    version: 1,
    paused: false,
    updated_at: "2026-06-14T12:00:00Z",
    health: {
      status: "healthy",
      consecutive_failures: 0,
      degraded_since: null,
      last_error: null,
      last_error_at: null,
    },
  };
}

function ccSlo(overrides: { id?: string; name: string }): CcSlo {
  return {
    id: overrides.id ?? "55555555-5555-5555-5555-555555555555",
    tenant: "org1",
    namespace: "",
    name: overrides.name,
    spec: {
      sli: { sql: "SELECT 1 AS good, 1 AS valid", label_columns: [] },
      targetPercent: 99.9,
      timeWindow: { duration: "30d", isRolling: true },
      annotations: {},
      suppressed: false,
    },
    version: 1,
    paused: false,
  };
}

/** A listRulesPage mock that only matches an exact `name` filter. */
function pagedByName(rules: readonly CcRuleView[]) {
  return async (
    _org: string,
    opts: { name?: string; limit?: number },
  ): Promise<{ items: CcRuleView[]; next_cursor: string | null }> => ({
    items: rules.filter((r) => r.name === opts.name).slice(0, opts.limit),
    next_cursor: null,
  });
}

/** A listSlos mock that only matches an exact `name` filter. */
function slosByName(slos: readonly CcSlo[]) {
  return async (_org: string, opts?: { name?: string }): Promise<CcSlo[]> =>
    slos.filter((s) => s.name === opts?.name);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCcRuleByName", () => {
  it("resolves a bare-named rule (engine-native / migration-backfilled) at project default", async () => {
    const rule = ccRule({ name: "rule-ab12cd34" });
    mocks.listRulesPage.mockImplementation(pagedByName([rule]));

    const result = await getCcRuleByName({
      data: { project: "default", slug: "rule-ab12cd34" },
    });

    expect(result).toEqual(rule);
    // Qualified attempt first, bare-slug fallback second.
    expect(mocks.listRulesPage).toHaveBeenNthCalledWith(
      1,
      "test_org",
      expect.objectContaining({ name: "default/rule-ab12cd34" }),
    );
    expect(mocks.listRulesPage).toHaveBeenNthCalledWith(
      2,
      "test_org",
      expect.objectContaining({ name: "rule-ab12cd34" }),
    );
  });

  it("resolves a qualified name on the first attempt, without falling back", async () => {
    const rule = ccRule({ name: "default/checkout-latency" });
    mocks.listRulesPage.mockImplementation(pagedByName([rule]));

    const result = await getCcRuleByName({
      data: { project: "default", slug: "checkout-latency" },
    });

    expect(result).toEqual(rule);
    expect(mocks.listRulesPage).toHaveBeenCalledTimes(1);
  });

  it("404s on a genuine miss (both the qualified and bare-slug attempts empty)", async () => {
    mocks.listRulesPage.mockImplementation(pagedByName([]));

    await expect(
      getCcRuleByName({ data: { project: "default", slug: "nope" } }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("does not fall back to the bare slug for a non-default project", async () => {
    const bareRule = ccRule({ name: "checkout-latency" });
    mocks.listRulesPage.mockImplementation(pagedByName([bareRule]));

    await expect(
      getCcRuleByName({
        data: { project: "payments", slug: "checkout-latency" },
      }),
    ).rejects.toMatchObject({ status: 404 });
    // Only the qualified attempt was made — no bare-slug retry.
    expect(mocks.listRulesPage).toHaveBeenCalledTimes(1);
  });
});

describe("getCcSloByName", () => {
  it("resolves a bare-named SLO (engine-native / migration-backfilled) at project default", async () => {
    const slo = ccSlo({ name: "slo-9f8e7d6c" });
    mocks.listSlos.mockImplementation(slosByName([slo]));

    const result = await getCcSloByName({
      data: { project: "default", slug: "slo-9f8e7d6c" },
    });

    expect(result).toEqual(slo);
    expect(mocks.listSlos).toHaveBeenNthCalledWith(
      1,
      "test_org",
      expect.objectContaining({ name: "default/slo-9f8e7d6c" }),
    );
    expect(mocks.listSlos).toHaveBeenNthCalledWith(
      2,
      "test_org",
      expect.objectContaining({ name: "slo-9f8e7d6c" }),
    );
  });

  it("resolves a qualified name on the first attempt, without falling back", async () => {
    const slo = ccSlo({ name: "default/checkout-availability" });
    mocks.listSlos.mockImplementation(slosByName([slo]));

    const result = await getCcSloByName({
      data: { project: "default", slug: "checkout-availability" },
    });

    expect(result).toEqual(slo);
    expect(mocks.listSlos).toHaveBeenCalledTimes(1);
  });

  it("404s on a genuine miss (both the qualified and bare-slug attempts empty)", async () => {
    mocks.listSlos.mockImplementation(slosByName([]));

    await expect(
      getCcSloByName({ data: { project: "default", slug: "nope" } }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("does not fall back to the bare slug for a non-default project", async () => {
    const bareSlo = ccSlo({ name: "checkout-availability" });
    mocks.listSlos.mockImplementation(slosByName([bareSlo]));

    await expect(
      getCcSloByName({
        data: { project: "payments", slug: "checkout-availability" },
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.listSlos).toHaveBeenCalledTimes(1);
  });
});
