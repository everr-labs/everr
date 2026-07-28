import { expect, it, vi } from "vitest";
import * as transport from "@/lib/clickety-clack.server";
import * as cc from "./client";

const ruleSpec = {
  sql: "SELECT 1",
  interval_secs: 30,
  for_secs: 0,
  label_columns: [],
  value_column: null,
  severity: "info" as const,
  annotations: {},
  resolve_after: 1,
  suppressed: false,
};

const ruleView = {
  id: "r1",
  tenant: "t",
  namespace: "",
  name: "",
  version: 1,
  paused: false,
  updated_at: "2026-06-14T12:00:00Z",
  spec: ruleSpec,
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

it("listAllRules walks the paginated envelope until next_cursor is null", async () => {
  const spy = vi
    .spyOn(transport, "ccRequest")
    .mockResolvedValueOnce({ items: [ruleView], next_cursor: "tok" })
    .mockResolvedValueOnce({
      items: [{ ...ruleView, id: "r2" }],
      next_cursor: null,
    });
  const out = await cc.listAllRules("org1");
  expect(spy).toHaveBeenNthCalledWith(1, "org1", "GET", "/v1/rules?limit=500");
  expect(spy).toHaveBeenNthCalledWith(
    2,
    "org1",
    "GET",
    "/v1/rules?limit=500&cursor=tok",
  );
  expect(out.map((r) => r.id)).toEqual(["r1", "r2"]);
});

it("listRulesPage GETs the paginated envelope with limit/cursor", async () => {
  const spy = vi
    .spyOn(transport, "ccRequest")
    .mockResolvedValue({ items: [ruleView], next_cursor: "tok" });
  const out = await cc.listRulesPage("org1", {
    limit: 100,
    cursor: "prev",
  });
  expect(spy).toHaveBeenCalledWith(
    "org1",
    "GET",
    "/v1/rules?limit=100&cursor=prev",
  );
  expect(out.items[0].id).toBe("r1");
  expect(out.next_cursor).toBe("tok");
});

it("listRulesPage defaults the limit and passes no cursor on the first page", async () => {
  const spy = vi
    .spyOn(transport, "ccRequest")
    .mockResolvedValue({ items: [], next_cursor: null });
  const out = await cc.listRulesPage("org1");
  expect(spy).toHaveBeenCalledWith("org1", "GET", "/v1/rules?limit=100");
  expect(out.next_cursor).toBeNull();
});

it("createRule posts first-class identity beside the flattened spec", async () => {
  const spy = vi.spyOn(transport, "ccRequest").mockResolvedValueOnce({
    id: "r1",
    tenant: "t",
    namespace: "",
    name: "default/api-errors",
    spec: ruleSpec,
    version: 1,
    paused: false,
  });
  const out = await cc.createRule("org1", {
    name: "default/api-errors",
    namespace: "",
    ...ruleSpec,
  });
  expect(spy).toHaveBeenCalledWith(
    "org1",
    "POST",
    "/v1/rules",
    expect.objectContaining({ name: "default/api-errors", namespace: "" }),
  );
  expect(out.name).toBe("default/api-errors");
});

it("listRulesPage threads namespace/name filters as query params", async () => {
  const spy = vi
    .spyOn(transport, "ccRequest")
    .mockResolvedValue({ items: [], next_cursor: null });
  await cc.listRulesPage("org1", { namespace: "", name: "default/api-errors" });
  expect(spy).toHaveBeenCalledWith(
    "org1",
    "GET",
    "/v1/rules?limit=100&namespace=&name=default%2Fapi-errors",
  );
});

it("listAllRules forwards namespace/name filters to every page", async () => {
  const spy = vi
    .spyOn(transport, "ccRequest")
    .mockResolvedValue({ items: [], next_cursor: null });
  await cc.listAllRules("org1", { namespace: "default", name: "api-errors" });
  expect(spy).toHaveBeenCalledWith(
    "org1",
    "GET",
    "/v1/rules?limit=500&namespace=default&name=api-errors",
  );
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

const sloSpec = {
  sli: { sql: "SELECT 1 AS good, 1 AS valid", label_columns: [] },
  targetPercent: 99.9,
  timeWindow: { duration: "30d", isRolling: true },
  annotations: {},
  suppressed: false,
};

it("listSlos threads namespace/name filters", async () => {
  const spy = vi.spyOn(transport, "ccRequest").mockResolvedValueOnce([]);
  await cc.listSlos("org1", { namespace: "", name: "default/checkout" });
  expect(spy).toHaveBeenCalledWith(
    "org1",
    "GET",
    "/v1/slos?namespace=&name=default%2Fcheckout",
  );
});

it("listSlos omits the query string when no filters are given", async () => {
  const spy = vi.spyOn(transport, "ccRequest").mockResolvedValueOnce([]);
  await cc.listSlos("org1");
  expect(spy).toHaveBeenCalledWith("org1", "GET", "/v1/slos");
});

it("updateSlo PUTs the spec without a name (identity is immutable)", async () => {
  const spy = vi.spyOn(transport, "ccRequest").mockResolvedValue({
    id: "slo1",
    tenant: "t",
    namespace: "",
    name: "checkout-availability",
    spec: sloSpec,
    version: 2,
    paused: false,
  });
  const out = await cc.updateSlo("org1", "slo1", sloSpec, 1);
  expect(spy).toHaveBeenCalledWith("org1", "PUT", "/v1/slos/slo1", {
    ...sloSpec,
    version: 1,
  });
  expect(out.version).toBe(2);
});

it("listSubscriptions GETs /v1/subscriptions and validates", async () => {
  const subs = [
    {
      id: "sub1",
      tenant: "t",
      webhook_url: "***",
      created_at: "2026-06-14T12:00:00Z",
    },
  ];
  const spy = vi.spyOn(transport, "ccRequest").mockResolvedValue(subs);
  const out = await cc.listSubscriptions("org1");
  expect(spy).toHaveBeenCalledWith("org1", "GET", "/v1/subscriptions");
  expect(out[0].webhook_url).toBe("***");
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
