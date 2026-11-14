import { organization } from "@everr/app/db/schema";
import {
  createTestDatabase,
  type TestDatabase,
} from "@everr/app/server/alerting/testing/pglite-database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { appEnv } from "./app/env";
import { productPolicy } from "./app/policy";
import { organizationBilling, orgSubscription } from "./db/schema";
import { cloudTestMigrations } from "./testing/migrations";

let fixture: TestDatabase;
vi.mock("@everr/app/db/client", () => ({
  get db() {
    return fixture.db;
  },
}));

beforeAll(async () => {
  fixture = await createTestDatabase(cloudTestMigrations);
  await fixture.db
    .insert(organization)
    .values(
      ["hobby-org", "pro-org"].map((id) => ({ id, name: id, slug: id, createdAt: new Date() })),
    );
  await fixture.db.insert(organizationBilling).values({ orgId: "pro-org", plan: "pro" });
  await fixture.db.insert(orgSubscription).values({
    orgId: "pro-org",
    polarSubscriptionId: "sub",
    polarProductId: appEnv.POLAR_PRO_PRODUCT_ID,
    status: "active",
    polarModifiedAt: new Date(),
  });
});
afterAll(async () => fixture?.close());

// Every alerting history write asks the product policy for the tenant's
// retention, so the billing query has to work against the real cloud schema.
describe("cloud retention read from billing", () => {
  it.each([
    ["hobby-org", 14, 14],
    ["pro-org", 365, 30],
  ])("resolves %s's retention", async (orgId, telemetryDays, evaluationDays) => {
    expect((await productPolicy.forOrganization(orgId)).retention).toEqual({
      tracesDays: telemetryDays,
      logsDays: telemetryDays,
      metricsDays: telemetryDays,
      alertEvaluationDays: evaluationDays,
      alertLifecycleDays: telemetryDays,
    });
  });
});
