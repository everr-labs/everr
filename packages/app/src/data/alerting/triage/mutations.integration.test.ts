// @vitest-environment node

/** The Alert rule state command, against a real PostgreSQL. */
import { describe, expect, it, vi } from "vite-plus/test";
import { insertRule } from "#app/server/alerting/testing/fixtures.ts";
import { registerAlertingHarness } from "#app/testing/alerting-harness.ts";

vi.mock("#app/db/client.ts", async () => {
  const { testDb, runInTransaction } = await import("#app/server/alerting/testing/db-proxy.ts");
  return { db: testDb, runInTransaction };
});

vi.mock("#app/lib/clickhouse.ts", async () => {
  const { clickhouseMock } = await import("#app/testing/test-clickhouse.ts");
  return clickhouseMock;
});

import { setAlertRulePaused } from "#app/data/alerting/triage/mutations.ts";

const harness = registerAlertingHarness();
const SESSION_ORG = "test_org";
const PATH = "default/checkout-latency";

describe("pausing an Alert rule from the Triage screen", () => {
  it("takes the rule by its path, the only identity the screen knows", async () => {
    await insertRule(harness().db, {
      organizationId: SESSION_ORG,
      slug: "checkout-latency",
    });

    expect(await setAlertRulePaused({ data: { path: PATH, paused: true } })).toEqual({
      paused: true,
    });
  });

  it("pauses nothing for a path no Alert rule has", async () => {
    await expect(
      setAlertRulePaused({
        data: { path: "default/no-such-rule", paused: true },
      }),
    ).rejects.toThrow();
  });
});
