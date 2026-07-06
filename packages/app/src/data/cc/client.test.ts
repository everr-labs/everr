import { expect, it, vi } from "vitest";
import * as transport from "@/lib/clickety-clack.server";
import * as cc from "./client";

const ruleView = {
  id: "r1",
  tenant: "t",
  version: 1,
  paused: false,
  spec: {
    sql: "SELECT 1",
    interval_secs: 30,
    for_secs: 0,
    label_columns: [],
    value_column: null,
    severity: "info",
    annotations: {},
    resolve_after: 1,
  },
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
};

it("listRules GETs /v1/rules and validates", async () => {
  const spy = vi.spyOn(transport, "ccRequest").mockResolvedValue([ruleView]);
  const out = await cc.listRules("org1");
  expect(spy).toHaveBeenCalledWith("org1", "GET", "/v1/rules");
  expect(out[0].health.status).toBe("healthy");
});

it("pauseRule POSTs the pause path", async () => {
  vi.spyOn(transport, "ccRequest").mockResolvedValue({
    ...ruleView,
    paused: true,
  });
  const out = await cc.pauseRule("org1", "r1");
  expect(out.paused).toBe(true);
  expect(transport.ccRequest).toHaveBeenCalledWith(
    "org1",
    "POST",
    "/v1/rules/r1/pause",
  );
});

it("createSilence POSTs body and validates response", async () => {
  const silence = {
    id: "s1",
    tenant: "t",
    matchers: [{ label: "h", op: "eq", value: "1" }],
    starts_at: "2026-06-14T00:00:00Z",
    ends_at: "2026-06-14T01:00:00Z",
    comment: null,
    author: null,
    created_at: "2026-06-14T00:00:00Z",
  };
  const spy = vi.spyOn(transport, "ccRequest").mockResolvedValue(silence);
  const body = {
    matchers: [{ label: "h", op: "eq" as const, value: "1" }],
    starts_at: "2026-06-14T00:00:00Z",
    ends_at: "2026-06-14T01:00:00Z",
  };
  const out = await cc.createSilence("org1", body);
  expect(spy).toHaveBeenCalledWith("org1", "POST", "/v1/silences", body);
  expect(out.id).toBe("s1");
});

const route = {
  id: "rt1",
  tenant: "t",
  matchers: [{ label: "severity", op: "eq", value: "critical" }],
  receiver: "oncall",
  continue: true,
  priority: 5,
  group_by: ["rule", "severity"],
  group_wait_secs: 15,
  group_interval_secs: 600,
  repeat_interval_secs: 3600,
};

it("createRoute POSTs body and round-trips repeat_interval_secs", async () => {
  const spy = vi.spyOn(transport, "ccRequest").mockResolvedValue(route);
  const input = {
    matchers: [{ label: "severity", op: "eq" as const, value: "critical" }],
    receiver: "oncall",
    continue: true,
    priority: 5,
    group_by: ["rule", "severity"],
    group_wait_secs: 15,
    group_interval_secs: 600,
    repeat_interval_secs: 3600,
  };
  const out = await cc.createRoute("org1", input);
  expect(spy).toHaveBeenCalledWith("org1", "POST", "/v1/routes", input);
  expect(out.repeat_interval_secs).toBe(3600);
  expect(out.continue).toBe(true);
});

it("updateRoute PUTs the id path and validates", async () => {
  const spy = vi
    .spyOn(transport, "ccRequest")
    .mockResolvedValue({ ...route, repeat_interval_secs: null });
  const input = {
    matchers: [{ label: "severity", op: "eq" as const, value: "critical" }],
    receiver: "oncall",
    continue: false,
    priority: 5,
    group_by: null,
    group_wait_secs: null,
    group_interval_secs: null,
    repeat_interval_secs: null,
  };
  const out = await cc.updateRoute("org1", "rt1", input);
  expect(spy).toHaveBeenCalledWith("org1", "PUT", "/v1/routes/rt1", input);
  expect(out.repeat_interval_secs).toBeNull();
});

it("listSubscriptions GETs /v1/subscriptions and validates", async () => {
  const subs = [
    {
      id: "sub1",
      tenant: "t",
      webhook_url: "https://example.com/hook",
      created_at: "2026-06-14T12:00:00Z",
    },
  ];
  const spy = vi.spyOn(transport, "ccRequest").mockResolvedValue(subs);
  const out = await cc.listSubscriptions("org1");
  expect(spy).toHaveBeenCalledWith("org1", "GET", "/v1/subscriptions");
  expect(out[0].webhook_url).toBe("https://example.com/hook");
  expect(out[0].created_at).toBe("2026-06-14T12:00:00Z");
});

it("deleteSubscription DELETEs the id path and validates", async () => {
  const spy = vi
    .spyOn(transport, "ccRequest")
    .mockResolvedValue({ deleted: true });
  const out = await cc.deleteSubscription("org1", "sub1");
  expect(spy).toHaveBeenCalledWith("org1", "DELETE", "/v1/subscriptions/sub1");
  expect(out.deleted).toBe(true);
});
