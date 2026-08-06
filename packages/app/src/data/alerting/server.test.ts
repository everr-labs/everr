// The slug-addressed rule/SLO by-name lookups: a single exact-match query
// against the qualified "project/slug" name (every stored name is qualified,
// "default/" included — there are no bare-slug names to fall back to).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AlertingChannelConfig,
  AlertingRuleView,
  AlertingSlo,
} from "@/data/alerting/types";
import { getPreviewScopes } from "@/data/previews/repoids";
import { query, querySqlApi } from "@/lib/clickhouse";
import { emailTestConfigFor } from "./email-test-config";
import {
  getAlertingRuleByName,
  getAlertingRuleEvaluationSeries,
  getAlertingSloBudgetNow,
  getAlertingSloBudgetSeries,
  getAlertingSloByName,
  listAlertingAlerts,
  testAlertingChannel,
} from "./server";
import { alertingRuleViewFixture as alertingRule } from "./test-fixtures";

const mocks = vi.hoisted(() => ({
  listRulesPage: vi.fn(),
  listSlos: vi.fn(),
  listAlerts: vi.fn(),
  listAllRules: vi.fn(),
  getRuleEvaluationSeries: vi.fn(),
  getSlo: vi.fn(),
  testChannel: vi.fn(),
}));

// The alerting engine client is the fns' only data plane; mocking it at the module
// boundary leaves the fallback logic real. emailTestConfigFor is a pure
// helper with its own coverage below, so it (and the rest of the real module)
// passes through untouched.
vi.mock("./repository", () => ({
  listRulesPage: mocks.listRulesPage,
  listSlos: mocks.listSlos,
  listAlerts: mocks.listAlerts,
  listAllRules: mocks.listAllRules,
  getRuleEvaluationSeries: mocks.getRuleEvaluationSeries,
  getSlo: mocks.getSlo,
  testChannel: mocks.testChannel,
}));

// server.ts also imports the preview-repoid resolver (unused by the by-name
// lookups under test), which pulls in the Postgres client and its server-only
// env at module load; stub it out so importing "./server" doesn't reach it.
vi.mock("@/data/previews/repoids", () => ({
  getPreviewScopes: vi.fn(),
  getCoveredRepoids: vi.fn(),
}));

vi.mock("@/data/alerts/history.server", () => ({
  queryPostgresAlertEventLog: vi.fn(),
  queryPostgresObservedLabelKeys: vi.fn(),
  queryPostgresObservedLabelValues: vi.fn(),
}));

function alertingSlo(overrides: { id?: string; name: string }): AlertingSlo {
  return {
    id: overrides.id ?? "55555555-5555-5555-5555-555555555555",
    tenant: "org1",
    repoid: "repo-1",
    previewId: null,
    name: overrides.name,
    spec: {
      sli: { sql: "SELECT 1 AS good, 1 AS valid" },
      targetPercent: 99.9,
      timeWindow: { duration: "30d", isRolling: true },
      annotations: {},
      suppressed: false,
    },
    version: 1,
    paused: false,
  };
}

/** A listAllRules mock honoring the exact Preview ownership filter. */
function rulesByNamespace(rules: readonly AlertingRuleView[]) {
  return async (
    _org: string,
    opts?: { previewId?: string | null },
  ): Promise<AlertingRuleView[]> =>
    rules.filter(
      (r) => opts?.previewId === undefined || r.previewId === opts.previewId,
    );
}

/** A listSlos mock honoring the exact Preview ownership filter. */
function slosByPreview(slos: readonly AlertingSlo[]) {
  return async (
    _org: string,
    opts?: { previewId?: string | null },
  ): Promise<AlertingSlo[]> =>
    slos.filter(
      (s) => opts?.previewId === undefined || s.previewId === opts.previewId,
    );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAlertingRuleByName", () => {
  it("resolves a qualified name from the live namespace in one request", async () => {
    const rule = alertingRule({ name: "default/checkout-latency" });
    mocks.listAllRules.mockImplementation(rulesByNamespace([rule]));

    const result = await getAlertingRuleByName({
      data: { project: "default", slug: "checkout-latency" },
    });

    expect(result).toEqual(rule);
    expect(mocks.listAllRules).toHaveBeenCalledTimes(1);
    expect(mocks.listAllRules).toHaveBeenCalledWith("test_org", {
      previewId: null,
    });
  });

  it("returns 404 for a missing canonical name", async () => {
    mocks.listAllRules.mockResolvedValue([]);
    await expect(
      getAlertingRuleByName({ data: { project: "default", slug: "nope" } }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("resolves the preview copy when a preview is selected", async () => {
    const owned = (id: string, previewId: string | null): AlertingRuleView => {
      const base = alertingRule({ id, name: "default/checkout-latency" });
      return {
        ...base,
        repoid: "repo-1",
        previewId,
      };
    };
    mocks.listAllRules.mockImplementation(
      rulesByNamespace([owned("r-live", null), owned("r-prev", "p1")]),
    );
    vi.mocked(getPreviewScopes).mockResolvedValue([
      { id: "p1", repoid: "repo-1" },
    ]);

    const result = await getAlertingRuleByName({
      data: { project: "default", slug: "checkout-latency", preview: "gio/x" },
    });

    expect(result.id).toBe("r-prev");
    expect(mocks.listRulesPage).not.toHaveBeenCalled();
  });
});

describe("getAlertingRuleEvaluationSeries", () => {
  it("resolves the range and keeps the repository read tenant-scoped", async () => {
    mocks.getRuleEvaluationSeries.mockResolvedValue({
      points: [],
      samples_truncated: false,
    });

    await getAlertingRuleEvaluationSeries({
      data: {
        ruleId: "11111111-1111-1111-1111-111111111111",
        timeRange: {
          from: "2026-08-06T12:00:00Z",
          to: "2026-08-06T13:00:00Z",
        },
        points: 120,
      },
    });

    expect(mocks.getRuleEvaluationSeries).toHaveBeenCalledWith(
      "test_org",
      "11111111-1111-1111-1111-111111111111",
      {
        from: new Date("2026-08-06T12:00:00Z"),
        to: new Date("2026-08-06T13:00:00Z"),
        points: 120,
      },
    );
  });
});

describe("getAlertingSloByName", () => {
  it("resolves a qualified live name in one request", async () => {
    const slo = alertingSlo({ name: "default/checkout-availability" });
    mocks.listSlos.mockImplementation(slosByPreview([slo]));

    const result = await getAlertingSloByName({
      data: { project: "default", slug: "checkout-availability" },
    });

    expect(result).toEqual(slo);
    expect(mocks.listSlos).toHaveBeenCalledTimes(1);
    expect(mocks.listSlos).toHaveBeenCalledWith("test_org", {
      previewId: null,
    });
  });

  it("returns 404 for a missing canonical name", async () => {
    mocks.listSlos.mockResolvedValue([]);
    await expect(
      getAlertingSloByName({ data: { project: "default", slug: "nope" } }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("resolves the preview copy when a preview is selected", async () => {
    const owned = (id: string, previewId: string | null): AlertingSlo => {
      const base = alertingSlo({ id, name: "default/checkout-availability" });
      return {
        ...base,
        repoid: "repo-1",
        previewId,
      };
    };
    mocks.listSlos.mockImplementation(
      slosByPreview([owned("s-live", null), owned("s-prev", "p1")]),
    );
    vi.mocked(getPreviewScopes).mockResolvedValue([
      { id: "p1", repoid: "repo-1" },
    ]);

    const result = await getAlertingSloByName({
      data: {
        project: "default",
        slug: "checkout-availability",
        preview: "gio/x",
      },
    });

    expect(result.id).toBe("s-prev");
    // The Preview overlay needs all SLOs, so the query is not pinned to live.
    expect(mocks.listSlos).toHaveBeenCalledWith("test_org");
  });
});

describe("SLO budget queries", () => {
  it("runs current and historical SLI scans as the hardened per-org SQL API user", async () => {
    const slo = alertingSlo({ name: "default/checkout-availability" });
    mocks.getSlo.mockResolvedValue(slo);
    vi.mocked(querySqlApi).mockResolvedValue([{ good: "999", valid: "1000" }]);

    await getAlertingSloBudgetNow({ data: { sloId: slo.id } });

    expect(querySqlApi).toHaveBeenCalledWith(slo.spec.sli.sql, "test_org", {
      window_start: expect.any(String),
      window_end: expect.any(String),
    });
    expect(query).not.toHaveBeenCalled();

    vi.mocked(querySqlApi).mockClear();
    await getAlertingSloBudgetSeries({
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
// tenant — including instances of suppressed preview rules/SLOs, which alerting engine
// evaluates fully. listAlertingAlerts must scope them out: live-only by default, and
// the selected preview's overlay when one is chosen.
describe("listAlertingAlerts", () => {
  function ownedRule(
    id: string,
    name: string,
    previewId: string | null,
    repoid = "repo-1",
  ): AlertingRuleView {
    const base = alertingRule({ id, name });
    return {
      ...base,
      repoid,
      previewId,
    };
  }

  function ownedSlo(
    id: string,
    name: string,
    previewId: string | null,
    repoid = "repo-1",
  ): AlertingSlo {
    const base = alertingSlo({ id, name });
    return {
      ...base,
      repoid,
      previewId,
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
      ownedRule("r-live", "default/high-errors", null),
      ownedRule("r-prev", "default/high-errors", "p1"),
      ownedRule("r-other", "default/other", "p2"),
      alertingRule({
        id: "r-native",
        name: "default/rule-ab12cd34",
        repoid: "repo-ui",
      }),
    ]);
    mocks.listSlos.mockResolvedValue([
      ownedSlo("s-live", "default/availability", null),
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
    const rows = await listAlertingAlerts();

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

    const rows = await listAlertingAlerts({ data: { preview: "gio/x" } });

    // r-prev/s-prev (in-scope preview) replace r-live/s-live (covered repo);
    // r-other (a different preview) stays hidden; the other repo stays.
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
      ownedRule("r-live-other-repo", "default/latency", null, "repo-9"),
      ownedRule("r-prev", "default/high-errors", "p1"),
    ]);
    mocks.listSlos.mockResolvedValue([]);
    mocks.listAlerts.mockResolvedValue([
      instance("r-live-other-repo"),
      instance("r-prev"),
    ]);

    const rows = await listAlertingAlerts({ data: { preview: "gio/x" } });
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
    const config: AlertingChannelConfig = {
      type: "email",
      to: ["oncall@acme.com", "ops@acme.com"],
    };
    expect(emailTestConfigFor(config, "gio@everr.dev")).toEqual({
      type: "email",
      to: ["gio@everr.dev"],
    });
  });

  it("leaves every other kind untouched", () => {
    const slack: AlertingChannelConfig = {
      type: "slack",
      url: "https://hooks.slack.com/x",
    };
    expect(emailTestConfigFor(slack, "gio@everr.dev")).toEqual(slack);

    const telegram: AlertingChannelConfig = {
      type: "telegram",
      bot_token: "t",
      chat_ids: ["1"],
    };
    expect(emailTestConfigFor(telegram, "gio@everr.dev")).toEqual(telegram);

    const webhook: AlertingChannelConfig = {
      type: "webhook",
      url: "https://example.com/hook",
    };
    expect(emailTestConfigFor(webhook, "gio@everr.dev")).toEqual(webhook);
  });

  it("replaces an empty recipient list too", () => {
    // An empty list would otherwise reach alerting engine and come back ok:false; the
    // substitution is unconditional for email so there is one rule, not two.
    const config: AlertingChannelConfig = { type: "email", to: [] };
    expect(emailTestConfigFor(config, "gio@everr.dev")).toEqual({
      type: "email",
      to: ["gio@everr.dev"],
    });
  });
});

// emailTestConfigFor above only proves the pure helper is correct. This
// exercises the actual wiring: testAlertingChannel must call it before forwarding
// to alerting.testChannel, so a refactor that dropped the wrapper would fail here
// even though every other suite (and typecheck, clippy, dead-code check)
// would stay green.
describe("testAlertingChannel", () => {
  // test-setup.ts's authenticated-server-fn mock injects this session email.
  const sessionEmail = "test@example.com";

  it("replaces an email config's recipients with the session's own address", async () => {
    mocks.testChannel.mockResolvedValue({ ok: true, latency_ms: 12 });
    const typed: AlertingChannelConfig = {
      type: "email",
      to: ["oncall@acme.com", "ops@acme.com"],
    };

    await testAlertingChannel({ data: { config: typed } });

    expect(mocks.testChannel).toHaveBeenCalledTimes(1);
    expect(mocks.testChannel).toHaveBeenCalledWith("test_org", {
      config: { type: "email", to: [sessionEmail] },
    });
  });

  it("forwards a Slack config unchanged", async () => {
    mocks.testChannel.mockResolvedValue({ ok: true, latency_ms: 12 });
    const slack: AlertingChannelConfig = {
      type: "slack",
      url: "https://hooks.slack.com/services/T/B/x",
    };

    await testAlertingChannel({ data: { config: slack } });

    expect(mocks.testChannel).toHaveBeenCalledWith("test_org", {
      config: slack,
    });
  });
});
