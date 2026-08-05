// The suggestion server fns: sources merged best-effort, synthetic keys
// flagged, and the engine's own vocabulary for synthetic values.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CcAlert, CcSlo } from "@/data/cc/types";
import { listCcLabelKeys, listCcLabelValues } from "./server";
import { ccRuleViewFixture } from "./test-fixtures";

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

// The CC client and the ClickHouse readers are the fns' only two data planes;
// mocking them at the module boundary leaves the merge logic real.
vi.mock("./client", () => ({
  listAllRules: mocks.listAllRules,
  listSlos: mocks.listSlos,
  listAlerts: mocks.listAlerts,
}));

vi.mock("@/data/alerts/history.server", () => ({
  queryAlertEventLog: vi.fn(),
  queryObservedLabelKeys: mocks.queryObservedLabelKeys,
  queryObservedLabelValues: mocks.queryObservedLabelValues,
}));

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

function ccSloFixture(overrides: { id?: string; name?: string } = {}): CcSlo {
  return {
    id: overrides.id ?? "55555555-5555-5555-5555-555555555555",
    tenant: "org1",
    namespace: "",
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

describe("listCcLabelKeys", () => {
  it("leads with the engine's reserved keys — dispatcher synthetics then the SLO pipeline's — flagged", async () => {
    const keys = await listCcLabelKeys();
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
      ccRuleViewFixture({
        name: "",
        spec: { label_columns: ["svc", "region"] },
      }),
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
    mocks.listAllRules.mockRejectedValue(new Error("cc down"));
    mocks.queryObservedLabelKeys.mockRejectedValue(new Error("ch down"));
    mocks.listAlerts.mockResolvedValue([ccAlert({ svc: "flap" })]);

    const keys = await listCcLabelKeys();
    expect(keys.map((k) => k.key)).toContain("svc");
    expect(keys.filter((k) => k.synthetic)).toHaveLength(6);
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
    mocks.listAllRules.mockResolvedValue([
      ccRuleViewFixture({
        id: "44444444-4444-4444-4444-444444444444",
        name: "",
        spec: { annotations: { "everr.display.name": "High 5xx rate" } },
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

  it("answers slo with the SLO ids the dispatcher stamps, name as hint", async () => {
    mocks.listSlos.mockResolvedValue([
      ccSloFixture({
        id: "55555555-5555-5555-5555-555555555555",
        name: "checkout-availability",
      }),
    ]);

    const values = await listCcLabelValues({ data: { key: "slo" } });
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
    mocks.listSlos.mockResolvedValue([ccSloFixture({})]);

    const values = await listCcLabelValues({ data: { key: "slo_tier" } });
    expect(values.map((v) => v.value)).toEqual([
      "fast-burn",
      "slow-burn",
      "ticket",
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
