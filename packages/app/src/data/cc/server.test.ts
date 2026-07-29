// The slug-addressed rule/SLO by-name lookups: a single exact-match query
// against the qualified "project/slug" name (every stored name is qualified,
// "default/" included — there are no bare-slug names to fall back to).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CcChannelConfig, CcRuleView, CcSlo } from "@/data/cc/types";
import { getPreviewScopes } from "@/data/previews/repoids";
import { query, querySqlApi } from "@/lib/clickhouse";
import { emailTestConfigFor } from "./client";
import {
  getCcRuleByName,
  getCcSloBudgetNow,
  getCcSloBudgetSeries,
  getCcSloByName,
  listCcAlerts,
} from "./server";

const mocks = vi.hoisted(() => ({
  listRulesPage: vi.fn(),
  listSlos: vi.fn(),
  listAlerts: vi.fn(),
  listAllRules: vi.fn(),
  getSlo: vi.fn(),
}));

// The CC client is the fns' only data plane; mocking it at the module
// boundary leaves the fallback logic real. emailTestConfigFor is a pure
// helper with its own coverage below, so it (and the rest of the real module)
// passes through untouched.
vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  listRulesPage: mocks.listRulesPage,
  listSlos: mocks.listSlos,
  listAlerts: mocks.listAlerts,
  listAllRules: mocks.listAllRules,
  getSlo: mocks.getSlo,
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

/** A listAllRules mock honoring CC's exact `namespace` filter. */
function rulesByNamespace(rules: readonly CcRuleView[]) {
  return async (
    _org: string,
    opts?: { namespace?: string },
  ): Promise<CcRuleView[]> =>
    rules.filter(
      (r) => opts?.namespace === undefined || r.namespace === opts.namespace,
    );
}

/** A listSlos mock honoring CC's exact `namespace` filter. */
function slosByNamespace(slos: readonly CcSlo[]) {
  return async (
    _org: string,
    opts?: { namespace?: string },
  ): Promise<CcSlo[]> =>
    slos.filter(
      (s) => opts?.namespace === undefined || s.namespace === opts.namespace,
    );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCcRuleByName", () => {
  it("resolves a qualified name from the live namespace in one request", async () => {
    const rule = ccRule({ name: "default/checkout-latency" });
    mocks.listAllRules.mockImplementation(rulesByNamespace([rule]));

    const result = await getCcRuleByName({
      data: { project: "default", slug: "checkout-latency" },
    });

    expect(result).toEqual(rule);
    expect(mocks.listAllRules).toHaveBeenCalledTimes(1);
    expect(mocks.listAllRules).toHaveBeenCalledWith("test_org", {
      namespace: "",
    });
  });

  it("resolves a bare stored name under the default project (legacy/engine-created rows)", async () => {
    const bareRule = ccRule({ name: "checkout-latency" });
    mocks.listAllRules.mockImplementation(rulesByNamespace([bareRule]));

    const result = await getCcRuleByName({
      data: { project: "default", slug: "checkout-latency" },
    });

    expect(result).toEqual(bareRule);
    expect(mocks.listAllRules).toHaveBeenCalledTimes(1);
  });

  it("prefers the qualified spelling when both coexist, and 404s on a real miss", async () => {
    const bare = ccRule({ id: "r-bare", name: "checkout-latency" });
    const qualified = ccRule({
      id: "r-qual",
      name: "default/checkout-latency",
    });
    mocks.listAllRules.mockImplementation(rulesByNamespace([bare, qualified]));

    const hit = await getCcRuleByName({
      data: { project: "default", slug: "checkout-latency" },
    });
    expect(hit.id).toBe("r-qual");

    await expect(
      getCcRuleByName({ data: { project: "default", slug: "nope" } }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("resolves the preview copy when a preview is selected", async () => {
    const owned = (id: string, namespace: string): CcRuleView => {
      const base = ccRule({ id, name: "default/checkout-latency" });
      return {
        ...base,
        namespace,
        spec: { ...base.spec, annotations: { "everr.repoid": "repo-1" } },
      };
    };
    mocks.listAllRules.mockImplementation(
      rulesByNamespace([owned("r-live", ""), owned("r-prev", "p1")]),
    );
    vi.mocked(getPreviewScopes).mockResolvedValue([
      { id: "p1", repoid: "repo-1" },
    ]);

    const result = await getCcRuleByName({
      data: { project: "default", slug: "checkout-latency", preview: "gio/x" },
    });

    expect(result.id).toBe("r-prev");
    expect(mocks.listRulesPage).not.toHaveBeenCalled();
  });
});

describe("getCcSloByName", () => {
  it("resolves a qualified name from the live namespace in one request", async () => {
    const slo = ccSlo({ name: "default/checkout-availability" });
    mocks.listSlos.mockImplementation(slosByNamespace([slo]));

    const result = await getCcSloByName({
      data: { project: "default", slug: "checkout-availability" },
    });

    expect(result).toEqual(slo);
    expect(mocks.listSlos).toHaveBeenCalledTimes(1);
    expect(mocks.listSlos).toHaveBeenCalledWith("test_org", {
      namespace: "",
    });
  });

  it("resolves a bare stored name under the default project (legacy/engine-created rows)", async () => {
    const bareSlo = ccSlo({ name: "checkout-availability" });
    mocks.listSlos.mockImplementation(slosByNamespace([bareSlo]));

    const result = await getCcSloByName({
      data: { project: "default", slug: "checkout-availability" },
    });

    expect(result).toEqual(bareSlo);

    await expect(
      getCcSloByName({ data: { project: "default", slug: "nope" } }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("resolves the preview copy when a preview is selected", async () => {
    const owned = (id: string, namespace: string): CcSlo => {
      const base = ccSlo({ id, name: "default/checkout-availability" });
      return {
        ...base,
        namespace,
        spec: { ...base.spec, annotations: { "everr.repoid": "repo-1" } },
      };
    };
    mocks.listSlos.mockImplementation(
      slosByNamespace([owned("s-live", ""), owned("s-prev", "p1")]),
    );
    vi.mocked(getPreviewScopes).mockResolvedValue([
      { id: "p1", repoid: "repo-1" },
    ]);

    const result = await getCcSloByName({
      data: {
        project: "default",
        slug: "checkout-availability",
        preview: "gio/x",
      },
    });

    expect(result.id).toBe("s-prev");
    // Across namespaces this time: no live-namespace pin on the query.
    expect(mocks.listSlos).toHaveBeenCalledWith("test_org");
  });
});

describe("SLO budget queries", () => {
  it("runs current and historical SLI scans as the hardened per-org SQL API user", async () => {
    const slo = ccSlo({ name: "default/checkout-availability" });
    mocks.getSlo.mockResolvedValue(slo);
    vi.mocked(querySqlApi).mockResolvedValue([{ good: "999", valid: "1000" }]);

    await getCcSloBudgetNow({ data: { sloId: slo.id } });

    expect(querySqlApi).toHaveBeenCalledWith(slo.spec.sli.sql, "test_org", {
      window_start: expect.any(String),
      window_end: expect.any(String),
    });
    expect(query).not.toHaveBeenCalled();

    vi.mocked(querySqlApi).mockClear();
    await getCcSloBudgetSeries({
      data: {
        sloId: slo.id,
        timeRange: { from: "now-1m", to: "now" },
        points: 2,
      },
    });

    expect(querySqlApi).toHaveBeenCalled();
    for (const [sql, organizationId, params] of vi.mocked(querySqlApi).mock
      .calls) {
      expect(sql).toBe(slo.spec.sli.sql);
      expect(organizationId).toBe("test_org");
      expect(params).toEqual({
        window_start: expect.any(String),
        window_end: expect.any(String),
      });
    }
    expect(query).not.toHaveBeenCalled();
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

describe("emailTestConfigFor", () => {
  it("sends an email test to the caller, never the typed recipients", () => {
    // The endpoint accepts an arbitrary config and delivers it. Without this,
    // any authenticated user could send mail to any address through our relay.
    const config: CcChannelConfig = {
      type: "email",
      to: ["oncall@acme.com", "ops@acme.com"],
    };
    expect(emailTestConfigFor(config, "gio@everr.dev")).toEqual({
      type: "email",
      to: ["gio@everr.dev"],
    });
  });

  it("leaves every other kind untouched", () => {
    const slack: CcChannelConfig = {
      type: "slack",
      url: "https://hooks.slack.com/x",
    };
    expect(emailTestConfigFor(slack, "gio@everr.dev")).toEqual(slack);

    const telegram: CcChannelConfig = {
      type: "telegram",
      bot_token: "t",
      chat_ids: ["1"],
    };
    expect(emailTestConfigFor(telegram, "gio@everr.dev")).toEqual(telegram);

    const webhook: CcChannelConfig = {
      type: "webhook",
      url: "https://example.com/hook",
    };
    expect(emailTestConfigFor(webhook, "gio@everr.dev")).toEqual(webhook);
  });

  it("replaces an empty recipient list too", () => {
    // An empty list would otherwise reach CC and come back ok:false; the
    // substitution is unconditional for email so there is one rule, not two.
    const config: CcChannelConfig = { type: "email", to: [] };
    expect(emailTestConfigFor(config, "gio@everr.dev")).toEqual({
      type: "email",
      to: ["gio@everr.dev"],
    });
  });
});
