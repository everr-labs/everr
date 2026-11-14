import { expect, it } from "vite-plus/test";
import { storage } from "./storage";

// Rows written for an organization carry its id as the tenant, the column the
// ClickHouse row policies filter on.
it("tags telemetry and app queries with the organization as tenant", () => {
  expect(storage.telemetryTenantId("org_42")).toBe("org_42");
  expect(storage.appQuerySettings("org_42", {})).toEqual({ SQL_everr_tenant_id: "org_42" });
});
