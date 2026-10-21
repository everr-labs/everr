// @vitest-environment node
import { createChdbDatabase } from "@everr/app/testing/alerting-storage";
import { expect, it } from "vite-plus/test";

it("includes the tenant column in the deployed alerting schema", () => {
  const database = createChdbDatabase();
  try {
    const columns = database.queryRows(
      "SELECT name, type FROM system.columns WHERE database = 'app' AND table = 'alert_events'",
    );
    expect(columns).toContainEqual({
      name: "tenant_id",
      type: "LowCardinality(String)",
    });
  } finally {
    database.close();
  }
});
