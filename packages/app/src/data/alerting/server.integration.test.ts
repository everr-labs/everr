// By-name lookups match one qualified project/slug. Stored names always include
// the project.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryClickHouseAlertEventLog } from "@/data/alerting/history/repository.server";
import type {
  AlertingChannelConfig,
  AlertingRuleView,
} from "@/data/alerting/types";
import { getPreviewScopes } from "@/data/previews/repoids";
import { testAlertingChannel } from "./delivery/server";
import { listAlertingEventHistory } from "./history/server";
import { listAlertingAlerts } from "./instances/server";
import {
  getAlertingRuleByName,
  getAlertingRuleEvaluationSeries,
} from "./rules/server";
import { alertingRuleViewFixture as alertingRule } from "./test-fixtures";

const mocks = vi.hoisted(() => ({
  listAlerts: vi.fn(),
  listAllRules: vi.fn(),
  getRuleEvaluationSeries: vi.fn(),
  testChannel: vi.fn(),
}));

// Mock each domain repository while keeping the server behavior real.
vi.mock("./rules/repository", () => ({
  listAllRules: mocks.listAllRules,
  getRuleEvaluationSeries: mocks.getRuleEvaluationSeries,
}));

vi.mock("./instances/repository", () => ({
  listAlerts: mocks.listAlerts,
}));

vi.mock("./delivery/repository", () => ({
  testChannel: mocks.testChannel,
}));

// These tests do not use preview scopes. Mock this module to avoid loading
// the Postgres environment.
vi.mock("@/data/previews/repoids", () => ({
  getPreviewScopes: vi.fn(),
  getCoveredRepoids: vi.fn(),
}));

vi.mock("@/data/alerting/history/repository.server", () => ({
  queryClickHouseAlertEventLog: vi.fn(),
  queryClickHouseObservedLabelKeys: vi.fn(),
  queryClickHouseObservedLabelValues: vi.fn(),
}));

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

    // Only reachable if the live-only filter (previewId: null) was skipped:
    // that filter would have excluded r-prev before the scope check ran.
    expect(result.id).toBe("r-prev");
  });
});

describe("getAlertingRuleEvaluationSeries", () => {
  it("resolves the range and keeps the repository read tenant-scoped", async () => {
    mocks.getRuleEvaluationSeries.mockResolvedValue({
      points: [],
      recent_points: [],
      evaluation_count: 0,
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

describe("listAlertingEventHistory", () => {
  it("passes absolute instants to ClickHouse history", async () => {
    vi.mocked(queryClickHouseAlertEventLog).mockResolvedValue([]);

    await listAlertingEventHistory({
      data: {
        limit: 200,
        timeRange: {
          from: "2026-08-06T12:00:00Z",
          to: "2026-08-06T13:00:00Z",
        },
        fingerprint: "fp-1",
        sourceId: "rule-1",
        slugs: ["demo/demo-always-firing"],
      },
    });

    expect(queryClickHouseAlertEventLog).toHaveBeenCalledWith("test_org", {
      limit: 200,
      from: new Date("2026-08-06T12:00:00Z"),
      to: new Date("2026-08-06T13:00:00Z"),
      previewIds: null,
      fingerprint: "fp-1",
      sourceId: "rule-1",
      slugs: ["demo/demo-always-firing"],
    });
  });
});

// Live results exclude suppressed previews unless that preview is selected.
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

  function instance(rule: string) {
    return {
      key: `${rule}|svc=api`,
      fingerprint: "svc=api",
      rule,
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
    mocks.listAlerts.mockResolvedValue([
      instance("r-live"),
      instance("r-prev"),
      instance("r-other"),
      instance("r-native"),
    ]);
  });

  it("hides preview instances from the live feed when no preview is selected", async () => {
    const rows = await listAlertingAlerts();

    expect(rows.map((r) => r.rule).sort()).toEqual(["r-live", "r-native"]);
    expect(vi.mocked(getPreviewScopes)).not.toHaveBeenCalled();
  });

  it("overlays the selected preview: its instances replace shadowed live ones", async () => {
    vi.mocked(getPreviewScopes).mockResolvedValue([
      { id: "p1", repoid: "repo-1" },
    ]);

    const rows = await listAlertingAlerts({ data: { preview: "gio/x" } });

    // r-prev replaces r-live in the covered repo. A different preview remains
    // hidden, and the rule from the other repo remains visible.
    expect(rows.map((r) => r.rule).sort()).toEqual(["r-native", "r-prev"]);
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

describe("testAlertingChannel", () => {
  it("forwards the config to the caller's own organization", async () => {
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
