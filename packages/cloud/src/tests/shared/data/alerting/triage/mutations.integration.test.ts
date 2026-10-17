// @vitest-environment node

/** The Alert rule state command, against a real PostgreSQL. */
import { describe, expect, it, vi } from "vitest";
import { useAlertingHarness } from "../../../../../testing/alerting-harness";
import { insertRule } from "@everr/app/server/alerting/testing/fixtures";

vi.mock("@everr/app/db/client", async () => {
  const { testDb, runInTransaction } = await import(
    "@everr/app/server/alerting/testing/db-proxy"
  );
  return { db: testDb, runInTransaction };
});

vi.mock(
  "@everr/app/lib/clickhouse",
  async () => import("../../../../../testing/test-clickhouse"),
);

import { setAlertRulePaused } from "@everr/app/data/alerting/triage/mutations";

const harness = useAlertingHarness();
const SESSION_ORG = "test_org";
const PATH = "default/checkout-latency";

describe("pausing an Alert rule from the Triage screen", () => {
  it("takes the rule by its path, the only identity the screen knows", async () => {
    await insertRule(harness().db, {
      organizationId: SESSION_ORG,
      slug: "checkout-latency",
    });

    expect(
      await setAlertRulePaused({ data: { path: PATH, paused: true } }),
    ).toEqual({ paused: true });
  });

  it("pauses nothing for a path no Alert rule has", async () => {
    await expect(
      setAlertRulePaused({
        data: { path: "default/no-such-rule", paused: true },
      }),
    ).rejects.toThrow();
  });
});
