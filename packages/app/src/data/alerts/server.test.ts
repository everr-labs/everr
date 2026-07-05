import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => new Headers(),
}));

vi.mock("@/data/cc/client", () => ({
  listRules: vi.fn(),
  getRule: vi.fn(),
  listAlerts: vi.fn(),
  listSilences: vi.fn(),
  createSilence: vi.fn(),
  deleteSilence: vi.fn(),
  pauseRule: vi.fn(),
  resumeRule: vi.fn(),
  listReceivers: vi.fn(),
  upsertReceiver: vi.fn(),
  listRoutes: vi.fn(),
  createRoute: vi.fn(),
}));

import * as cc from "@/data/cc/client";
import { auth } from "@/lib/auth.server";
import { MANAGED_SIMPLE, OWN_MANAGED, OWN_NAME, OWN_REPO } from "./mapping";
import {
  activateAlert,
  createSilence,
  deactivateAlert,
  getAlert,
  listAlertSilences,
  listAlerts,
  updateAlertSettings,
} from "./server";

const mock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>;

const ruleView = (over: Record<string, unknown> = {}) => ({
  id: "rule-1",
  tenant: "test_org",
  version: 1,
  paused: false,
  health: {
    status: "healthy",
    consecutive_failures: 0,
    degraded_since: null,
    last_error: null,
    last_error_at: null,
  },
  rollup: {
    alert_state: "inactive",
    firing_instance_count: 0,
    last_fired_at: null,
    last_resolved_at: null,
    last_seen_at: null,
    last_row_count: null,
  },
  spec: {
    sql: "SELECT 1",
    interval_secs: 300,
    for_secs: 0,
    label_columns: ["route"],
    value_column: null,
    severity: "info",
    resolve_after: 1,
    annotations: {
      [OWN_NAME]: "high-5xx",
      [OWN_REPO]: "repo-1",
      [OWN_MANAGED]: MANAGED_SIMPLE,
    },
  },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getActiveMemberRole).mockResolvedValue({
    role: "admin",
  } as never);
});

describe("listAlerts", () => {
  it("returns only everr-managed rules", async () => {
    mock(cc.listRules).mockResolvedValue([
      ruleView(),
      ruleView({ id: "power", spec: { ...ruleView().spec, annotations: {} } }),
    ]);
    mock(cc.listSilences).mockResolvedValue([]);
    const out = await listAlerts();
    expect(out.map((a) => a.id)).toEqual(["rule-1"]);
    expect(out[0].slug).toBe("high-5xx");
    expect(out[0].active).toBe(true);
    expect(out[0].severity).toBe("info");
    expect(out[0].currentState).toBe("resolved");
  });

  it("counts silences scoped by the rule label", async () => {
    mock(cc.listRules).mockResolvedValue([ruleView()]);
    mock(cc.listSilences).mockResolvedValue([
      { id: "s1", matchers: [{ label: "rule", op: "eq", value: "rule-1" }] },
      { id: "s2", matchers: [{ label: "rule", op: "eq", value: "other" }] },
    ]);
    const out = await listAlerts();
    expect(out[0].activeSilenceCount).toBe(1);
  });
});

describe("getAlert", () => {
  it("rejects non-managed rules", async () => {
    mock(cc.getRule).mockResolvedValue(
      ruleView({ spec: { ...ruleView().spec, annotations: {} } }),
    );
    mock(cc.listSilences).mockResolvedValue([]);
    await expect(getAlert({ data: { alertId: "x" } })).rejects.toThrow(
      "Alert not found",
    );
  });
});

describe("listAlertSilences", () => {
  it("hides the synthetic rule matcher", async () => {
    mock(cc.getRule).mockResolvedValue(ruleView());
    mock(cc.listSilences).mockResolvedValue([
      {
        id: "s1",
        starts_at: "2026-01-01T00:00:00Z",
        ends_at: "2030-01-01T00:00:00Z",
        comment: "noisy",
        author: "u1",
        matchers: [
          { label: "rule", op: "eq", value: "rule-1" },
          { label: "route", op: "eq", value: "/x" },
        ],
      },
    ]);
    const out = await listAlertSilences({ data: { alertId: "rule-1" } });
    expect(out).toHaveLength(1);
    expect(out[0].matchers).toEqual([{ label: "route", op: "=", value: "/x" }]);
  });
});

describe("createSilence", () => {
  it("tags the silence with the rule matcher", async () => {
    mock(cc.getRule).mockResolvedValue(ruleView());
    mock(cc.createSilence).mockResolvedValue({ id: "s1" });
    await createSilence({
      data: {
        alertId: "rule-1",
        endsAt: "2030-01-01T00:00:00.000Z",
        reason: "",
        matchers: [],
      },
    });
    const body = mock(cc.createSilence).mock.calls[0][1];
    expect(body.matchers).toContainEqual({
      label: "rule",
      op: "eq",
      value: "rule-1",
    });
  });

  it("converts UI matcher ops to CC ops", async () => {
    mock(cc.getRule).mockResolvedValue(ruleView());
    mock(cc.createSilence).mockResolvedValue({ id: "s1" });
    await createSilence({
      data: {
        alertId: "rule-1",
        endsAt: "2030-01-01T00:00:00.000Z",
        reason: "",
        matchers: [{ label: "route", op: "=~", value: "/api/.*" }],
      },
    });
    const body = mock(cc.createSilence).mock.calls[0][1];
    expect(body.matchers).toContainEqual({
      label: "route",
      op: "regex",
      value: "/api/.*",
    });
  });
});

describe("updateAlertSettings", () => {
  it("upserts both managed receivers and ensures catch-all routes", async () => {
    mock(cc.listRoutes).mockResolvedValue([]);
    await updateAlertSettings({
      data: { delivery: { email: { enabled: true, to: ["a@b.c"] } } },
    });
    const names = mock(cc.upsertReceiver).mock.calls.map((c) => c[1].name);
    expect(names).toEqual(["everr-default-email", "everr-default-telegram"]);
    expect(cc.createRoute).toHaveBeenCalledTimes(2);
  });

  it("does not recreate existing catch-all routes", async () => {
    mock(cc.listRoutes).mockResolvedValue([
      { matchers: [], receiver: "everr-default-email" },
      { matchers: [], receiver: "everr-default-telegram" },
    ]);
    await updateAlertSettings({
      data: { delivery: { email: { enabled: true, to: ["a@b.c"] } } },
    });
    expect(cc.createRoute).not.toHaveBeenCalled();
  });
});

describe("activate/deactivate", () => {
  it("resumes the CC rule", async () => {
    mock(cc.resumeRule).mockResolvedValue({ id: "rule-1" });
    await activateAlert({ data: { alertId: "rule-1" } });
    expect(cc.resumeRule).toHaveBeenCalledWith("test_org", "rule-1");
  });

  it("pauses the CC rule", async () => {
    mock(cc.pauseRule).mockResolvedValue({ id: "rule-1" });
    await deactivateAlert({ data: { alertId: "rule-1" } });
    expect(cc.pauseRule).toHaveBeenCalledWith("test_org", "rule-1");
  });
});
