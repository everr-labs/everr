// The slug-addressed rule/SLO by-name lookups: a single exact-match query
// against the qualified "project/slug" name (every stored name is qualified,
// "default/" included — there are no bare-slug names to fall back to).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CcRuleView, CcSlo } from "@/data/cc/types";
import { getPreviewScopes } from "@/data/previews/repoids";
import { getCcRuleByName, getCcSloByName, listCcAlerts } from "./server";

const mocks = vi.hoisted(() => ({
  listRulesPage: vi.fn(),
  listSlos: vi.fn(),
  listAlerts: vi.fn(),
  listAllRules: vi.fn(),
}));

// The CC client is the fns' only data plane; mocking it at the module
// boundary leaves the fallback logic real.
vi.mock("./client", () => ({
  listRulesPage: mocks.listRulesPage,
  listSlos: mocks.listSlos,
  listAlerts: mocks.listAlerts,
  listAllRules: mocks.listAllRules,
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
  it("resolves a qualified name with a single exact-match lookup", async () => {
    const rule = ccRule({ name: "default/checkout-latency" });
    mocks.listRulesPage.mockImplementation(pagedByName([rule]));

    const result = await getCcRuleByName({
      data: { project: "default", slug: "checkout-latency" },
    });

    expect(result).toEqual(rule);
    expect(mocks.listRulesPage).toHaveBeenCalledTimes(1);
    expect(mocks.listRulesPage).toHaveBeenCalledWith(
      "test_org",
      expect.objectContaining({
        namespace: "",
        name: "default/checkout-latency",
      }),
    );
  });

  it("404s on a miss with no bare-slug retry (stored names are always qualified)", async () => {
    const bareRule = ccRule({ name: "checkout-latency" });
    mocks.listRulesPage.mockImplementation(pagedByName([bareRule]));

    await expect(
      getCcRuleByName({
        data: { project: "default", slug: "checkout-latency" },
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.listRulesPage).toHaveBeenCalledTimes(1);
  });
});

describe("getCcSloByName", () => {
  it("resolves a qualified name with a single exact-match lookup", async () => {
    const slo = ccSlo({ name: "default/checkout-availability" });
    mocks.listSlos.mockImplementation(slosByName([slo]));

    const result = await getCcSloByName({
      data: { project: "default", slug: "checkout-availability" },
    });

    expect(result).toEqual(slo);
    expect(mocks.listSlos).toHaveBeenCalledTimes(1);
    expect(mocks.listSlos).toHaveBeenCalledWith(
      "test_org",
      expect.objectContaining({
        namespace: "",
        name: "default/checkout-availability",
      }),
    );
  });

  it("404s on a miss with no bare-slug retry (stored names are always qualified)", async () => {
    const bareSlo = ccSlo({ name: "checkout-availability" });
    mocks.listSlos.mockImplementation(slosByName([bareSlo]));

    await expect(
      getCcSloByName({
        data: { project: "default", slug: "checkout-availability" },
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.listSlos).toHaveBeenCalledTimes(1);
  });
});

// The live alert feed: /v1/alerts returns every non-inactive instance for the
// tenant — including instances of suppressed preview rules/SLOs, which CC
// evaluates fully. listCcAlerts must scope them out: live-only by default, and
// the selected preview's overlay when one is chosen.
describe("listCcAlerts", () => {
  function ownedRule(
    id: string,
    name: string,
    namespace: string,
    repoid = "repo-1",
  ): CcRuleView {
    const base = ccRule({ id, name });
    return {
      ...base,
      namespace,
      spec: { ...base.spec, annotations: { "everr.repoid": repoid } },
    };
  }

  function ownedSlo(
    id: string,
    name: string,
    namespace: string,
    repoid = "repo-1",
  ): CcSlo {
    const base = ccSlo({ id, name });
    return {
      ...base,
      namespace,
      spec: { ...base.spec, annotations: { "everr.repoid": repoid } },
    };
  }

  function instance(rule: string, slo?: string) {
    return {
      key: `${slo ?? rule}|svc=api`,
      rule: slo ?? rule,
      ...(slo !== undefined ? { slo } : {}),
      tenant: "test_org",
      status: "firing",
      labels: { svc: "api" },
      value: null,
      active_since: null,
      last_seen: null,
      absent_count: 0,
    };
  }

  beforeEach(() => {
    mocks.listAllRules.mockResolvedValue([
      ownedRule("r-live", "default/high-errors", ""),
      ownedRule("r-prev", "default/high-errors", "p1"),
      ownedRule("r-other", "default/other", "p2"),
      // Engine-native (unowned) live rule: always visible.
      ccRule({ id: "r-native", name: "rule-ab12cd34" }),
    ]);
    mocks.listSlos.mockResolvedValue([
      ownedSlo("s-live", "default/availability", ""),
      ownedSlo("s-prev", "default/availability", "p1"),
    ]);
    mocks.listAlerts.mockResolvedValue([
      instance("r-live"),
      instance("r-prev"),
      instance("r-other"),
      instance("r-native"),
      instance("", "s-live"),
      instance("", "s-prev"),
    ]);
  });

  it("hides preview instances from the live feed when no preview is selected", async () => {
    const rows = await listCcAlerts();

    expect(rows.map((r) => r.rule).sort()).toEqual([
      "r-live",
      "r-native",
      "s-live",
    ]);
    expect(vi.mocked(getPreviewScopes)).not.toHaveBeenCalled();
  });

  it("overlays the selected preview: its instances replace shadowed live ones", async () => {
    vi.mocked(getPreviewScopes).mockResolvedValue([
      { id: "p1", repoid: "repo-1" },
    ]);

    const rows = await listCcAlerts({ data: { preview: "gio/x" } });

    // r-prev/s-prev (in-scope preview) replace r-live/s-live (covered repo);
    // r-other (a different preview) stays hidden; the native rule stays.
    expect(rows.map((r) => r.rule).sort()).toEqual([
      "r-native",
      "r-prev",
      "s-prev",
    ]);
    expect(vi.mocked(getPreviewScopes)).toHaveBeenCalledWith(
      "test_org",
      "gio/x",
    );
  });

  it("keeps live rules from repos the preview does not cover", async () => {
    vi.mocked(getPreviewScopes).mockResolvedValue([
      { id: "p1", repoid: "repo-1" },
    ]);
    mocks.listAllRules.mockResolvedValue([
      ownedRule("r-live-other-repo", "default/latency", "", "repo-9"),
      ownedRule("r-prev", "default/high-errors", "p1"),
    ]);
    mocks.listSlos.mockResolvedValue([]);
    mocks.listAlerts.mockResolvedValue([
      instance("r-live-other-repo"),
      instance("r-prev"),
    ]);

    const rows = await listCcAlerts({ data: { preview: "gio/x" } });
    expect(rows.map((r) => r.rule).sort()).toEqual([
      "r-live-other-repo",
      "r-prev",
    ]);
  });
});
