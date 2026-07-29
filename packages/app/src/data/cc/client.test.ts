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
