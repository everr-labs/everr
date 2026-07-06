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
  testRule: vi.fn(),
  listReceivers: vi.fn(),
  upsertReceiver: vi.fn(),
  listRoutes: vi.fn(),
  createRoute: vi.fn(),
  updateRoute: vi.fn(),
}));

// The preview registry lookup touches Postgres (module-level db client); the
// overlay tests feed it directly.
vi.mock("@/data/previews/repoids", () => ({ getPreviewRegistry: vi.fn() }));

import * as cc from "@/data/cc/client";
import { getPreviewRegistry } from "@/data/previews/repoids";
import { auth } from "@/lib/auth.server";
import { OWN_NAME, OWN_REPO } from "./mapping";
import {
  activateAlert,
  createSilence,
  deactivateAlert,
  getAlert,
  getAlertSettings,
  listAlertInstances,
  listAlertSilences,
  listAlerts,
  testAlert,
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
    },
  },
  ...over,
});

// A rule view with a distinct identity/spec, for overlay tests. `previewId`
// tags the spec as a preview rule (suppressed + everr.preview).
function rule(
  id: string,
  slug: string,
  opts: {
    repoid?: string;
    previewId?: string;
    sql?: string;
    annotations?: Record<string, string>;
  } = {},
) {
  const base = ruleView();
  return {
    ...base,
    id,
    spec: {
      ...base.spec,
      sql: opts.sql ?? base.spec.sql,
      suppressed: opts.previewId !== undefined,
      annotations: {
        [OWN_NAME]: slug,
        [OWN_REPO]: opts.repoid ?? "repo-1",
        ...(opts.previewId ? { "everr.preview": opts.previewId } : {}),
        ...opts.annotations,
      },
    },
  };
}

// A bare (power-user) CC rule: no everr annotations at all.
const bareRule = (id = "power") =>
  ruleView({ id, spec: { ...ruleView().spec, annotations: {} } });

// An active (currently in-window) silence scoped to rule-1 by default.
const silence = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  starts_at: "2020-01-01T00:00:00Z",
  ends_at: "2999-01-01T00:00:00Z",
  matchers: [{ label: "rule", op: "eq", value: "rule-1" }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getActiveMemberRole).mockResolvedValue({
    role: "admin",
  } as never);
});

describe("listAlerts", () => {
  it("returns every tenant rule, everr-owned and bare alike", async () => {
    mock(cc.listRules).mockResolvedValue([
      ruleView(),
      ruleView({ id: "power", spec: { ...ruleView().spec, annotations: {} } }),
    ]);
    mock(cc.listSilences).mockResolvedValue([]);
    const out = await listAlerts();
    expect(out.map((a) => a.id)).toEqual(["rule-1", "power"]);
    const owned = out.find((a) => a.id === "rule-1");
    expect(owned?.slug).toBe("high-5xx");
    expect(owned?.active).toBe(true);
    expect(owned?.severity).toBe("info");
    expect(owned?.currentState).toBe("resolved");
    expect(owned?.ownedByRepo).toBe("repo-1");
    // Bare CC rule (no everr annotations at all): fromCcRuleSpec's tolerant
    // fallback, not a synthesized name.
    const bare = out.find((a) => a.id === "power");
    expect(bare?.slug).toBe("");
    expect(bare?.displayName).toBeNull();
    expect(bare?.ownedByRepo).toBeNull();
  });

  it("counts only active silences scoped by the rule label", async () => {
    mock(cc.listRules).mockResolvedValue([ruleView()]);
    mock(cc.listSilences).mockResolvedValue([
      silence({ id: "s1" }),
      // Scoped to a different rule — ignored.
      silence({
        id: "s2",
        matchers: [{ label: "rule", op: "eq", value: "other" }],
      }),
    ]);
    const out = await listAlerts();
    expect(out[0].activeSilenceCount).toBe(1);
  });

  it("ignores silences outside their active window and reports the latest expiry", async () => {
    mock(cc.listRules).mockResolvedValue([ruleView()]);
    mock(cc.listSilences).mockResolvedValue([
      // Already ended — not active.
      silence({
        id: "expired",
        starts_at: "2020-01-01T00:00:00Z",
        ends_at: "2020-01-02T00:00:00Z",
      }),
      // Not started yet — not active.
      silence({
        id: "future",
        starts_at: "2999-01-01T00:00:00Z",
        ends_at: "2999-06-01T00:00:00Z",
      }),
      // Active, expires sooner.
      silence({ id: "near", ends_at: "2999-01-01T00:00:00Z" }),
      // Active, expires later — this is the reported expiry.
      silence({ id: "far", ends_at: "2999-12-31T00:00:00Z" }),
    ]);
    const out = await listAlerts();
    expect(out[0].activeSilenceCount).toBe(2);
    expect(out[0].activeSilenceExpiresAt).toBe(
      new Date("2999-12-31T00:00:00Z").toISOString(),
    );
  });

  it("has no expiry when nothing is actively silenced", async () => {
    mock(cc.listRules).mockResolvedValue([ruleView()]);
    mock(cc.listSilences).mockResolvedValue([]);
    const out = await listAlerts();
    expect(out[0].activeSilenceCount).toBe(0);
    expect(out[0].activeSilenceExpiresAt).toBeNull();
  });

  it("surfaces health, runbook link, and staleness timing on the summary", async () => {
    mock(cc.listRules).mockResolvedValue([
      ruleView({
        health: {
          status: "degraded",
          consecutive_failures: 3,
          degraded_since: "2026-01-01T00:00:00Z",
          last_error: "boom",
          last_error_at: "2026-01-01T00:00:00Z",
        },
        rollup: {
          alert_state: "inactive",
          firing_instance_count: 0,
          last_fired_at: null,
          last_resolved_at: null,
          last_seen_at: "2026-06-01T00:00:00Z",
          last_row_count: null,
        },
        spec: {
          ...ruleView().spec,
          interval_secs: 300,
          annotations: {
            ...ruleView().spec.annotations,
            "everr.runbook": "web/db-latency",
          },
        },
      }),
    ]);
    mock(cc.listSilences).mockResolvedValue([]);
    const out = await listAlerts();
    expect(out[0].health).toBe("degraded");
    expect(out[0].healthError).toBe("boom");
    expect(out[0].healthConsecutiveFailures).toBe(3);
    expect(out[0].healthLastErrorAt).toBe("2026-01-01T00:00:00Z");
    expect(out[0].runbookProject).toBe("web");
    expect(out[0].runbookSlug).toBe("db-latency");
    expect(out[0].lastSeenAt).toBe("2026-06-01T00:00:00Z");
    expect(out[0].evaluationIntervalSeconds).toBe(300);
  });

  it("reports zero consecutive failures for a healthy rule", async () => {
    mock(cc.listRules).mockResolvedValue([ruleView()]);
    mock(cc.listSilences).mockResolvedValue([]);
    const out = await listAlerts();
    expect(out[0].health).toBe("healthy");
    expect(out[0].healthConsecutiveFailures).toBe(0);
    expect(out[0].healthLastErrorAt).toBeNull();
  });

  it("excludes preview rules from the live list", async () => {
    mock(cc.listRules).mockResolvedValue([
      rule("live-1", "high-5xx"),
      rule("prev-1-rule", "high-5xx", { previewId: "prev-1" }),
    ]);
    mock(cc.listSilences).mockResolvedValue([]);
    const out = await listAlerts();
    expect(out.map((a) => a.id)).toEqual(["live-1"]);
    expect(out[0].previewId).toBeNull();
    expect(out[0].previewStatus).toBeUndefined();
  });
});

describe("listAlerts preview overlay", () => {
  beforeEach(() => {
    mock(cc.listSilences).mockResolvedValue([]);
    // The preview "pr" was applied once, for repo-1, as registry row prev-1.
    mock(getPreviewRegistry).mockResolvedValue(new Map([["prev-1", "repo-1"]]));
  });

  it("replaces live rules with this preview's for covered repoids", async () => {
    mock(cc.listRules).mockResolvedValue([
      // Live rule with a preview counterpart whose spec differs -> the preview
      // copy is shown, marked changed.
      rule("live-a", "edited"),
      rule("prev-a", "edited", { previewId: "prev-1", sql: "SELECT 2" }),
      // Identical preview counterpart -> shown, unchanged.
      rule("live-b", "same"),
      rule("prev-b", "same", { previewId: "prev-1" }),
      // Preview-only rule -> added.
      rule("prev-c", "brand-new", { previewId: "prev-1" }),
      // Live-only rule in the covered repo -> kept, marked removed.
      rule("live-d", "gone"),
      // Live rule of an uncovered repo -> passes through untagged.
      rule("live-e", "elsewhere", { repoid: "repo-2" }),
      // Another preview's rule -> invisible in this overlay.
      rule("prev-f", "other-preview", { previewId: "prev-9" }),
    ]);

    const out = await listAlerts({ data: { preview: "pr" } });
    const byId = new Map(out.map((a) => [a.id, a]));
    expect(byId.get("prev-a")?.previewStatus).toBe("changed");
    expect(byId.get("prev-b")?.previewStatus).toBe("unchanged");
    expect(byId.get("prev-c")?.previewStatus).toBe("added");
    expect(byId.get("live-d")?.previewStatus).toBe("removed");
    expect(byId.get("live-e")?.previewStatus).toBeUndefined();
    // The shadowed live copies and foreign preview rules are not listed.
    expect(byId.has("live-a")).toBe(false);
    expect(byId.has("live-b")).toBe(false);
    expect(byId.has("prev-f")).toBe(false);
    // Preview rows surface their owning registry id.
    expect(byId.get("prev-a")?.previewId).toBe("prev-1");
  });

  it("ignores suppressed/everr.preview/link.alert when diffing live vs preview", async () => {
    // The pair differs ONLY by the namespace bookkeeping the split implies:
    // suppressed, everr.preview, and each rule's own link.alert.
    const live = rule("live-a", "same", {
      annotations: { "link.alert": "https://app.example.com/alerts/live-a" },
    });
    const prev = rule("prev-a", "same", {
      previewId: "prev-1",
      annotations: { "link.alert": "https://app.example.com/alerts/prev-a" },
    });
    mock(cc.listRules).mockResolvedValue([live, prev]);

    const out = await listAlerts({ data: { preview: "pr" } });
    expect(out).toHaveLength(1);
    expect(out[0].previewStatus).toBe("unchanged");
  });
});

describe("getAlert", () => {
  it("returns non-managed (bare) rules", async () => {
    mock(cc.getRule).mockResolvedValue(
      ruleView({ spec: { ...ruleView().spec, annotations: {} } }),
    );
    mock(cc.listSilences).mockResolvedValue([]);
    const out = await getAlert({ data: { alertId: "x" } });
    expect(out.slug).toBe("");
    expect(out.displayName).toBeNull();
    expect(out.ownedByRepo).toBeNull();
    expect(out.display.name).toBeUndefined();
  });

  it("computes the overlay status of a preview rule in a preview context", async () => {
    const prev = rule("prev-a", "edited", {
      previewId: "prev-1",
      sql: "SELECT 2",
    });
    mock(cc.getRule).mockResolvedValue(prev);
    mock(cc.listRules).mockResolvedValue([rule("live-a", "edited"), prev]);
    mock(cc.listSilences).mockResolvedValue([]);
    mock(getPreviewRegistry).mockResolvedValue(new Map([["prev-1", "repo-1"]]));

    const out = await getAlert({ data: { alertId: "prev-a", preview: "pr" } });
    expect(out.previewId).toBe("prev-1");
    expect(out.previewStatus).toBe("changed");
  });

  it("carries no preview status outside a preview context", async () => {
    mock(cc.getRule).mockResolvedValue(
      rule("prev-a", "edited", { previewId: "prev-1" }),
    );
    mock(cc.listSilences).mockResolvedValue([]);
    const out = await getAlert({ data: { alertId: "prev-a" } });
    // Still identifiable as a preview rule (the detail page badges it)...
    expect(out.previewId).toBe("prev-1");
    // ...but no overlay ran: no registry lookup, no status.
    expect(out.previewStatus).toBeUndefined();
    expect(getPreviewRegistry).not.toHaveBeenCalled();
  });
});

describe("listAlertInstances", () => {
  it("lists firing instances of a bare CC rule", async () => {
    mock(cc.getRule).mockResolvedValue(bareRule());
    mock(cc.listAlerts).mockResolvedValue([
      {
        rule: "power",
        status: "firing",
        key: "fp-1",
        labels: { route: "/x" },
        active_since: "2026-01-01T00:00:00Z",
        value: 7,
      },
      // Another rule's instance stays out.
      {
        rule: "other",
        status: "firing",
        key: "fp-2",
        labels: {},
        active_since: "2026-01-01T00:00:00Z",
        value: null,
      },
    ]);
    mock(cc.listSilences).mockResolvedValue([]);
    const out = await listAlertInstances({
      data: { alertId: "power", timeRange: { from: "now-1h", to: "now" } },
    });
    expect(out).toHaveLength(1);
    expect(out[0].fingerprint).toBe("fp-1");
    expect(out[0].labels).toEqual({ route: "/x" });
    expect(out[0].state).toBe("firing");
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

  it("lists silences of a bare CC rule", async () => {
    mock(cc.getRule).mockResolvedValue(bareRule());
    mock(cc.listSilences).mockResolvedValue([
      silence({ matchers: [{ label: "rule", op: "eq", value: "power" }] }),
    ]);
    const out = await listAlertSilences({ data: { alertId: "power" } });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("s1");
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

  it("silences a bare CC rule", async () => {
    mock(cc.getRule).mockResolvedValue(bareRule());
    mock(cc.createSilence).mockResolvedValue({ id: "s1" });
    await createSilence({
      data: {
        alertId: "power",
        endsAt: "2030-01-01T00:00:00.000Z",
        reason: "",
        matchers: [],
      },
    });
    const body = mock(cc.createSilence).mock.calls[0][1];
    expect(body.matchers).toContainEqual({
      label: "rule",
      op: "eq",
      value: "power",
    });
  });
});

// A complete managed catch-all route (empty matchers) as CC returns it.
const catchAllRoute = (
  receiver: string,
  priority: number,
  repeat_interval_secs: number | null = null,
) => ({
  id: `route-${receiver}`,
  tenant: "test_org",
  matchers: [],
  receiver,
  continue: true,
  priority,
  group_by: null,
  group_wait_secs: null,
  group_interval_secs: null,
  repeat_interval_secs,
});

const managedCatchAllRoutes = (repeat_interval_secs: number | null = null) => [
  catchAllRoute("everr-default-email", 1000, repeat_interval_secs),
  catchAllRoute("everr-default-telegram", 1001, repeat_interval_secs),
  catchAllRoute("everr-default-slack", 1002, repeat_interval_secs),
];

describe("updateAlertSettings", () => {
  it("upserts all managed receivers and ensures catch-all routes", async () => {
    mock(cc.listRoutes).mockResolvedValue([]);
    await updateAlertSettings({
      data: { delivery: { email: { enabled: true, to: ["a@b.c"] } } },
    });
    const names = mock(cc.upsertReceiver).mock.calls.map((c) => c[1].name);
    expect(names).toEqual([
      "everr-default-email",
      "everr-default-telegram",
      "everr-default-slack",
    ]);
    expect(cc.createRoute).toHaveBeenCalledTimes(3);
  });

  it("provisions the Slack receiver with its webhook URL", async () => {
    mock(cc.listRoutes).mockResolvedValue([]);
    const url = "https://hooks.slack.com/services/T00/B00/xyz";
    await updateAlertSettings({
      data: { delivery: { slack: { enabled: true, webhookUrl: url } } },
    });
    const slack = mock(cc.upsertReceiver)
      .mock.calls.map((c) => c[1])
      .find((r) => r.name === "everr-default-slack");
    expect(slack.channel).toEqual({ type: "slack", url });
  });

  it("clears the Slack URL when the channel is disabled", async () => {
    mock(cc.listRoutes).mockResolvedValue([]);
    await updateAlertSettings({
      data: {
        delivery: {
          slack: {
            enabled: false,
            webhookUrl: "https://hooks.slack.com/services/T00/B00/xyz",
          },
        },
      },
    });
    const slack = mock(cc.upsertReceiver)
      .mock.calls.map((c) => c[1])
      .find((r) => r.name === "everr-default-slack");
    expect(slack.channel).toEqual({ type: "slack", url: "" });
  });

  it("does not recreate existing catch-all routes", async () => {
    mock(cc.listRoutes).mockResolvedValue(managedCatchAllRoutes(null));
    await updateAlertSettings({
      data: { delivery: { email: { enabled: true, to: ["a@b.c"] } } },
    });
    expect(cc.createRoute).not.toHaveBeenCalled();
  });

  it("creates missing routes with the chosen repeat interval", async () => {
    mock(cc.listRoutes).mockResolvedValue([]);
    await updateAlertSettings({
      data: {
        delivery: {
          email: { enabled: true, to: ["a@b.c"] },
          remindEverySeconds: 3600,
        },
      },
    });
    expect(cc.updateRoute).not.toHaveBeenCalled();
    expect(cc.createRoute).toHaveBeenCalledTimes(3);
    for (const call of mock(cc.createRoute).mock.calls) {
      expect(call[1].repeat_interval_secs).toBe(3600);
    }
  });

  it("reconciles existing routes in place via updateRoute, touching only the interval", async () => {
    mock(cc.listRoutes).mockResolvedValue(managedCatchAllRoutes(null));
    await updateAlertSettings({
      data: {
        delivery: {
          email: { enabled: true, to: ["a@b.c"] },
          remindEverySeconds: 14400,
        },
      },
    });
    expect(cc.createRoute).not.toHaveBeenCalled();
    expect(cc.updateRoute).toHaveBeenCalledTimes(3);
    const emailCall = mock(cc.updateRoute).mock.calls.find(
      (c) => c[1] === "route-everr-default-email",
    );
    expect(emailCall?.[2]).toEqual({
      matchers: [],
      receiver: "everr-default-email",
      continue: true,
      priority: 1000,
      group_by: null,
      group_wait_secs: null,
      group_interval_secs: null,
      repeat_interval_secs: 14400,
    });
  });

  it("leaves routes untouched when the interval already matches", async () => {
    mock(cc.listRoutes).mockResolvedValue(managedCatchAllRoutes(3600));
    await updateAlertSettings({
      data: {
        delivery: {
          email: { enabled: true, to: ["a@b.c"] },
          remindEverySeconds: 3600,
        },
      },
    });
    expect(cc.createRoute).not.toHaveBeenCalled();
    expect(cc.updateRoute).not.toHaveBeenCalled();
  });
});

describe("getAlertSettings", () => {
  it("reads remindEverySeconds back from the managed routes", async () => {
    mock(cc.listReceivers).mockResolvedValue([]);
    mock(cc.listRoutes).mockResolvedValue(managedCatchAllRoutes(3600));
    const { delivery } = await getAlertSettings();
    expect(delivery.remindEverySeconds).toBe(3600);
  });

  it("surfaces the max when the managed routes disagree", async () => {
    mock(cc.listReceivers).mockResolvedValue([]);
    mock(cc.listRoutes).mockResolvedValue([
      catchAllRoute("everr-default-email", 1000, 3600),
      catchAllRoute("everr-default-telegram", 1001, 86400),
      catchAllRoute("everr-default-slack", 1002, null),
    ]);
    const { delivery } = await getAlertSettings();
    expect(delivery.remindEverySeconds).toBe(86400);
  });

  it("is null when no managed route carries an interval", async () => {
    mock(cc.listReceivers).mockResolvedValue([]);
    mock(cc.listRoutes).mockResolvedValue(managedCatchAllRoutes(null));
    const { delivery } = await getAlertSettings();
    expect(delivery.remindEverySeconds).toBeNull();
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

describe("testAlert", () => {
  const testResult = {
    matched: 2,
    rows: [{ labels: { route: "/x" }, value: 5 }],
  };

  it("tests the CC rule with the loaded spec", async () => {
    mock(cc.getRule).mockResolvedValue(ruleView());
    mock(cc.testRule).mockResolvedValue(testResult);
    const out = await testAlert({ data: { alertId: "rule-1" } });
    expect(cc.testRule).toHaveBeenCalledWith(
      "test_org",
      "rule-1",
      ruleView().spec,
    );
    expect(out).toEqual(testResult);
  });

  it("runs non-managed (bare) rules", async () => {
    const bare = ruleView({
      id: "x",
      spec: { ...ruleView().spec, annotations: {} },
    });
    mock(cc.getRule).mockResolvedValue(bare);
    mock(cc.testRule).mockResolvedValue(testResult);
    const out = await testAlert({ data: { alertId: "x" } });
    expect(cc.testRule).toHaveBeenCalledWith("test_org", "x", bare.spec);
    expect(out).toEqual(testResult);
  });

  it("is gated to org admins, like pause/resume", async () => {
    vi.mocked(auth.api.getActiveMemberRole).mockResolvedValue({
      role: "member",
    } as never);
    mock(cc.getRule).mockResolvedValue(ruleView());
    try {
      await testAlert({ data: { alertId: "rule-1" } });
      expect.fail("expected testAlert to reject a non-admin");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "Only organization admins can manage alerts",
      );
    }
    expect(cc.testRule).not.toHaveBeenCalled();
  });
});
