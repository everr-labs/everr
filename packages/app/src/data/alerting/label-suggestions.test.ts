// Suggestion sources merge best-effort and flag synthetic values.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertingAlert, AlertingSlo } from "@/data/alerting/types";
import { listAlertingLabelKeys, listAlertingLabelValues } from "./server";
import { alertingRuleViewFixture } from "./test-fixtures";

// ./server transitively imports @/data/previews/repoids -> @/db/client, whose
// t3-env access throws under jsdom; stub the db module before that chain loads.
vi.mock("@/db/client", () => ({ db: {} }));

const mocks = vi.hoisted(() => ({
  listAllRules: vi.fn(),
  listSlos: vi.fn(),
  listAlerts: vi.fn(),
  queryObservedLabelKeys: vi.fn(),
  queryObservedLabelValues: vi.fn(),
}));

// The alert repository and history readers are the fns' two data planes;
// mocking them at the module boundary leaves the merge logic real.
vi.mock("./repository", () => ({
  listAllRules: mocks.listAllRules,
  listSlos: mocks.listSlos,
  listAlerts: mocks.listAlerts,
}));

vi.mock("@/data/alerting/history/repository.server", () => ({
  queryPostgresAlertEventLog: vi.fn(),
  queryPostgresObservedLabelKeys: mocks.queryObservedLabelKeys,
  queryPostgresObservedLabelValues: mocks.queryObservedLabelValues,
}));

function alertingAlert(labels: Record<string, string>): AlertingAlert {
  return {
    key: "k1",
    fingerprint: "k1",
    rule: "44444444-4444-4444-4444-444444444444",
    tenant: "org1",
    status: "firing",
    labels,
    value: 1,
    active_since: null,
    last_seen: null,
    absent_count: 0,
  };
}

function alertingSloFixture(
  overrides: { id?: string; name?: string } = {},
): AlertingSlo {
  return {
    id: overrides.id ?? "55555555-5555-5555-5555-555555555555",
    tenant: "org1",
    repoid: "repo-1",
    previewId: null,
    name: overrides.name ?? "checkout-availability",
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAllRules.mockResolvedValue([]);
  mocks.listSlos.mockResolvedValue([]);
  mocks.listAlerts.mockResolvedValue([]);
  mocks.queryObservedLabelKeys.mockResolvedValue([]);
  mocks.queryObservedLabelValues.mockResolvedValue([]);
});

describe("listAlertingLabelKeys", () => {
  it("leads with reserved dispatcher and SLO keys", async () => {
    const keys = await listAlertingLabelKeys();
    expect(keys).toEqual([
      { key: "severity", synthetic: true },
      { key: "status", synthetic: true },
      { key: "rule", synthetic: true },
      { key: "kind", synthetic: true },
      { key: "slo", synthetic: true },
      { key: "slo_tier", synthetic: true },
    ]);
  });

  it("merges observed history, rule label_columns, and instance labels, deduped", async () => {
    mocks.queryObservedLabelKeys.mockResolvedValue(["svc", "host"]);
    mocks.listAllRules.mockResolvedValue([
      alertingRuleViewFixture({
        name: "default/high-5xx",
        spec: { label_columns: ["svc", "region"] },
      }),
    ]);
    mocks.listAlerts.mockResolvedValue([
      alertingAlert({ host: "web-1", az: "a" }),
    ]);

    const keys = await listAlertingLabelKeys();
    expect(keys.filter((k) => !k.synthetic).map((k) => k.key)).toEqual([
      "svc",
      "host",
      "region",
      "az",
    ]);
  });

  it("keeps a user label that collides with a synthetic key flagged synthetic (synthetics win at dispatch)", async () => {
    mocks.queryObservedLabelKeys.mockResolvedValue(["severity", "svc"]);

    const keys = await listAlertingLabelKeys();
    expect(keys.filter((k) => k.key === "severity")).toEqual([
      { key: "severity", synthetic: true },
    ]);
    expect(keys.map((k) => k.key)).toContain("svc");
  });

  it("still answers when a source fails: suggestions assist, never block", async () => {
    mocks.listAllRules.mockRejectedValue(new Error("rules unavailable"));
    mocks.queryObservedLabelKeys.mockRejectedValue(
      new Error("history unavailable"),
    );
    mocks.listAlerts.mockResolvedValue([alertingAlert({ svc: "flap" })]);

    const keys = await listAlertingLabelKeys();
    expect(keys.map((k) => k.key)).toContain("svc");
    expect(keys.filter((k) => k.synthetic)).toHaveLength(6);
  });
});

describe("listAlertingLabelValues", () => {
  it("answers severity, status, and kind with their known values", async () => {
    expect(
      await listAlertingLabelValues({ data: { key: "severity" } }),
    ).toEqual([{ value: "info" }, { value: "warning" }, { value: "critical" }]);
    expect(await listAlertingLabelValues({ data: { key: "status" } })).toEqual([
      { value: "firing" },
      { value: "resolved" },
    ]);
    expect(await listAlertingLabelValues({ data: { key: "kind" } })).toEqual([
      { value: "alert" },
      { value: "rule_health" },
    ]);
  });

  it("answers rule with the rule IDs the dispatcher matches on, friendly name as hint", async () => {
    mocks.listAllRules.mockResolvedValue([
      alertingRuleViewFixture({
        id: "44444444-4444-4444-4444-444444444444",
        name: "default/high-5xx",
        spec: { annotations: { "everr.display.name": "High 5xx rate" } },
      }),
    ]);

    const values = await listAlertingLabelValues({ data: { key: "rule" } });
    expect(values).toEqual([
      {
        value: "44444444-4444-4444-4444-444444444444",
        hint: "High 5xx rate",
      },
    ]);
  });

  it("answers slo with the SLO ids the dispatcher stamps, name as hint", async () => {
    mocks.listSlos.mockResolvedValue([
      alertingSloFixture({
        id: "55555555-5555-5555-5555-555555555555",
        name: "default/checkout-availability",
      }),
    ]);

    const values = await listAlertingLabelValues({ data: { key: "slo" } });
    expect(values).toEqual([
      {
        value: "55555555-5555-5555-5555-555555555555",
        hint: "checkout-availability",
      },
    ]);
  });

  it("answers slo_tier with the fixed canonical tier names", async () => {
    // Every SLO evaluates the same canonical tiers, so the suggestions are the
    // three canonical names regardless of the tenant's SLO set.
    mocks.listSlos.mockResolvedValue([alertingSloFixture({})]);

    const values = await listAlertingLabelValues({ data: { key: "slo_tier" } });
    expect(values.map((v) => v.value)).toEqual([
      "fast-burn",
      "slow-burn",
      "ticket",
    ]);
  });

  it("merges current-instance values with observed history for plain keys", async () => {
    mocks.listAlerts.mockResolvedValue([
      alertingAlert({ svc: "flap" }),
      alertingAlert({ svc: "api" }),
    ]);
    mocks.queryObservedLabelValues.mockResolvedValue(["api", "worker"]);

    const values = await listAlertingLabelValues({ data: { key: "svc" } });
    expect(values.map((v) => v.value)).toEqual(["flap", "api", "worker"]);
    expect(mocks.queryObservedLabelValues).toHaveBeenCalledWith(
      expect.any(String),
      "svc",
      expect.objectContaining({ limit: 100 }),
    );
  });

  it("still answers plain keys when a source fails", async () => {
    mocks.listAlerts.mockRejectedValue(new Error("alerts unavailable"));
    mocks.queryObservedLabelValues.mockResolvedValue(["flap"]);

    const values = await listAlertingLabelValues({ data: { key: "svc" } });
    expect(values).toEqual([{ value: "flap" }]);
  });
});
