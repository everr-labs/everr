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
