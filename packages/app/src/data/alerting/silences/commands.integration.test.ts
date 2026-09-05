// @vitest-environment node

/**
 * The Silence commands, against a real PostgreSQL.
 *
 * The repositories under this module are covered by the pipeline suites, so
 * these cases assert only what this layer adds on top: the Matcher every
 * Silence must carry, and the rule resolution that happens before anything is
 * muted.
 *
 * The Organization is `test_org`, not the fixtures' default: the session these
 * server functions run with comes from the global mock in `src/test-setup.ts`,
 * and that is the Organization it says is active.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { alertSilences } from "@/db/schema";
import { insertRule } from "@/server/alerting/testing/fixtures";
import { useAlertingHarness } from "@/server/alerting/testing/harness";

vi.mock("@/db/client", async () => {
  const { testDb, runInTransaction } = await import(
    "@/server/alerting/testing/db-proxy"
  );
  return { db: testDb, runInTransaction };
});

vi.mock(
  "@/lib/clickhouse",
  async () => import("@/server/alerting/testing/test-clickhouse"),
);

import { createAlertSilence } from "./server";

const harness = useAlertingHarness();

/** The Organization the mocked session is acting as. */
const SESSION_ORG = "test_org";

const PATH = "default/checkout-latency";

async function storedSilence(id: string) {
  const [row] = await harness()
    .db.select()
    .from(alertSilences)
    .where(eq(alertSilences.id, id));
  return row;
}

describe("creating an Alert silence", () => {
  it("scopes the Silence to the rule, never to the label alone", async () => {
    const rule = await insertRule(harness().db, {
      organizationId: SESSION_ORG,
      slug: "checkout-latency",
    });

    const { id } = await createAlertSilence({
      data: {
        path: PATH,
        durationMinutes: 30,
        matchers: "host=web-1",
        comment: "deploying",
      },
    });

    // The rule Matcher comes first and is always present. Without it this
    // Silence would mute host=web-1 across every Alert rule the Organization
    // has, not one rule on one host.
    // Its value is the rule's row id, not the path the caller sent: the
    // mutation resolves the one into the other, and delivery matches on the
    // id it stored.
    expect((await storedSilence(id)).matchers).toEqual([
      { label: "rule", op: "eq", value: rule.id },
      { label: "host", op: "eq", value: "web-1" },
    ]);
  });

  it("writes a whole-rule Silence when no Matchers were typed", async () => {
    const rule = await insertRule(harness().db, {
      organizationId: SESSION_ORG,
      slug: "checkout-latency",
    });

    const { id } = await createAlertSilence({
      data: { path: PATH, durationMinutes: 30, matchers: "", comment: "" },
    });

    expect((await storedSilence(id)).matchers).toEqual([
      { label: "rule", op: "eq", value: rule.id },
    ]);
  });

  it("mutes nothing for a path no Alert rule has", async () => {
    await insertRule(harness().db, {
      organizationId: SESSION_ORG,
      slug: "checkout-latency",
    });

    await expect(
      createAlertSilence({
        data: {
          path: "default/no-such-rule",
          durationMinutes: 30,
          matchers: "",
          comment: "",
        },
      }),
    ).rejects.toThrow();

    // The rule is resolved before the Silence is written, so nothing landed.
    expect(await harness().db.select().from(alertSilences)).toEqual([]);
  });

  it("refuses a Matcher that is not a pair before it writes anything", async () => {
    await insertRule(harness().db, {
      organizationId: SESSION_ORG,
      slug: "checkout-latency",
    });

    await expect(
      createAlertSilence({
        data: {
          path: PATH,
          durationMinutes: 30,
          matchers: "host",
          comment: "",
        },
      }),
    ).rejects.toThrow(/label=value/);

    expect(await harness().db.select().from(alertSilences)).toEqual([]);
  });
});
