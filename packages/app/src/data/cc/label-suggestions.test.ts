// The suggestion server fns: sources merged best-effort, synthetic keys
// flagged, and the engine's own vocabulary for synthetic values.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CcAlert, CcRuleView } from "@/data/cc/types";
import { listCcLabelKeys, listCcLabelValues } from "./server";

const mocks = vi.hoisted(() => ({
  listRules: vi.fn(),
  listAlerts: vi.fn(),
  queryObservedLabelKeys: vi.fn(),
  queryObservedLabelValues: vi.fn(),
}));

// The CC client and the ClickHouse readers are the fns' only two data planes;
// mocking them at the module boundary leaves the merge logic real.
vi.mock("./client", () => ({
  listRules: mocks.listRules,
  listAlerts: mocks.listAlerts,
}));

vi.mock("@/data/alerts/history.server", () => ({
  queryAlertEventLog: vi.fn(),
  queryObservedLabelKeys: mocks.queryObservedLabelKeys,
  queryObservedLabelValues: mocks.queryObservedLabelValues,
}));

function ccRule(overrides: {
  id?: string;
  label_columns?: string[];
  annotations?: Record<string, string>;
}): CcRuleView {
  return {
    id: overrides.id ?? "44444444-4444-4444-4444-444444444444",
    tenant: "org1",
    spec: {
      sql: "SELECT 1",
      interval_secs: 60,
      for_secs: 0,
      label_columns: overrides.label_columns ?? [],
      severity: "critical",
      annotations: overrides.annotations ?? {},
      resolve_after: 1,
      suppressed: false,
    },
    version: 1,
    paused: false,
    health: {
      status: "healthy",
      consecutive_failures: 0,
      degraded_since: null,
      last_error: null,
      last_error_at: null,
    },
  };
}

function ccAlert(labels: Record<string, string>): CcAlert {
  return {
    key: "k1",
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listRules.mockResolvedValue([]);
  mocks.listAlerts.mockResolvedValue([]);
  mocks.queryObservedLabelKeys.mockResolvedValue([]);
  mocks.queryObservedLabelValues.mockResolvedValue([]);
});

describe("listCcLabelKeys", () => {
  it("leads with the dispatcher's synthetic keys, flagged", async () => {
    const keys = await listCcLabelKeys();
    expect(keys).toEqual([
      { key: "severity", synthetic: true },
      { key: "status", synthetic: true },
      { key: "rule", synthetic: true },
      { key: "kind", synthetic: true },
    ]);
  });

  it("merges observed history, rule label_columns, and instance labels, deduped", async () => {
    mocks.queryObservedLabelKeys.mockResolvedValue(["svc", "host"]);
    mocks.listRules.mockResolvedValue([
      ccRule({ label_columns: ["svc", "region"] }),
    ]);
    mocks.listAlerts.mockResolvedValue([ccAlert({ host: "web-1", az: "a" })]);

    const keys = await listCcLabelKeys();
    expect(keys.filter((k) => !k.synthetic).map((k) => k.key)).toEqual([
      "svc",
      "host",
      "region",
      "az",
    ]);
  });

  it("keeps a user label that collides with a synthetic key flagged synthetic (synthetics win at dispatch)", async () => {
    mocks.queryObservedLabelKeys.mockResolvedValue(["severity", "svc"]);

    const keys = await listCcLabelKeys();
    expect(keys.filter((k) => k.key === "severity")).toEqual([
      { key: "severity", synthetic: true },
    ]);
    expect(keys.map((k) => k.key)).toContain("svc");
  });

  it("still answers when a source fails: suggestions assist, never block", async () => {
    mocks.listRules.mockRejectedValue(new Error("cc down"));
    mocks.queryObservedLabelKeys.mockRejectedValue(new Error("ch down"));
    mocks.listAlerts.mockResolvedValue([ccAlert({ svc: "flap" })]);

    const keys = await listCcLabelKeys();
    expect(keys.map((k) => k.key)).toContain("svc");
    expect(keys.filter((k) => k.synthetic)).toHaveLength(4);
  });
});

describe("listCcLabelValues", () => {
  it("answers severity/status/kind with the engine's known sets", async () => {
    expect(await listCcLabelValues({ data: { key: "severity" } })).toEqual([
      { value: "info" },
      { value: "warning" },
      { value: "critical" },
    ]);
    expect(await listCcLabelValues({ data: { key: "status" } })).toEqual([
      { value: "firing" },
      { value: "resolved" },
    ]);
    expect(await listCcLabelValues({ data: { key: "kind" } })).toEqual([
      { value: "alert" },
      { value: "rule_health" },
    ]);
  });

  it("answers rule with the rule IDs the dispatcher matches on, friendly name as hint", async () => {
    mocks.listRules.mockResolvedValue([
      ccRule({
        id: "44444444-4444-4444-4444-444444444444",
        annotations: { "everr.display.name": "High 5xx rate" },
      }),
    ]);

    const values = await listCcLabelValues({ data: { key: "rule" } });
    expect(values).toEqual([
      {
        value: "44444444-4444-4444-4444-444444444444",
        hint: "High 5xx rate",
      },
    ]);
  });

  it("merges current-instance values with observed history for plain keys", async () => {
    mocks.listAlerts.mockResolvedValue([
      ccAlert({ svc: "flap" }),
      ccAlert({ svc: "api" }),
    ]);
    mocks.queryObservedLabelValues.mockResolvedValue(["api", "worker"]);

    const values = await listCcLabelValues({ data: { key: "svc" } });
    expect(values.map((v) => v.value)).toEqual(["flap", "api", "worker"]);
    expect(mocks.queryObservedLabelValues).toHaveBeenCalledWith(
      expect.any(Function),
      "svc",
      expect.objectContaining({ limit: 100 }),
    );
  });

  it("still answers plain keys when a source fails", async () => {
    mocks.listAlerts.mockRejectedValue(new Error("cc down"));
    mocks.queryObservedLabelValues.mockResolvedValue(["flap"]);

    const values = await listCcLabelValues({ data: { key: "svc" } });
    expect(values).toEqual([{ value: "flap" }]);
  });
});
