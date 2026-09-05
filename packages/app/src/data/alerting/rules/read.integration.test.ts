// @vitest-environment node

/**
 * The app's PostgreSQL reads of Alert rules, against a real engine.
 *
 * The pure half of this module is covered by the unit suites beside it. What
 * only a real database can answer is what the queries select and in what
 * order: an ORDER BY that never ran, a filter that let a Preview copy through,
 * or a path that resolved to the wrong row all give back rows the assembler
 * then formats perfectly.
 */
import { describe, expect, it, vi } from "vitest";
import { ANN_DISPLAY_NAME } from "@/data/alerting/resource-annotations";
import { alertInstances } from "@/db/schema";
import {
  insertPreview,
  insertRule,
  TEST_ORG,
} from "@/server/alerting/testing/fixtures";
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

import {
  loadInstances,
  loadRule,
  loadRuleInstances,
  loadRules,
  rulePath,
} from "./read";

const harness = useAlertingHarness();

/** One tracked Alert instance of a rule, with the value the list ranks it by. */
async function insertInstance(
  alertDefinitionId: string,
  overrides: {
    fingerprint: string;
    value: number;
    status?: "inactive" | "pending" | "firing";
  },
) {
  await harness()
    .db.insert(alertInstances)
    .values({
      organizationId: TEST_ORG,
      alertDefinitionId,
      fingerprint: overrides.fingerprint,
      status: overrides.status ?? "firing",
      labels: { service: overrides.fingerprint },
      value: overrides.value,
    });
}

describe("the Alert rules the app reads", () => {
  it("leaves out a Preview copy", async () => {
    const preview = await insertPreview(harness().db);
    await insertRule(harness().db, { slug: "live-rule" });
    await insertRule(harness().db, {
      slug: "live-rule",
      previewId: preview.id,
    });

    const rules = await loadRules(TEST_ORG);

    expect(rules.map(rulePath)).toEqual(["default/live-rule"]);
  });

  it("sorts by the name the inventory prints, not by the slug behind it", async () => {
    await insertRule(harness().db, {
      slug: "zzz-last-by-slug",
      annotations: { [ANN_DISPLAY_NAME]: "Alpha latency" },
    });
    await insertRule(harness().db, {
      slug: "aaa-first-by-slug",
      annotations: { [ANN_DISPLAY_NAME]: "Zeta latency" },
    });

    const rules = await loadRules(TEST_ORG);

    expect(rules.map(rulePath)).toEqual([
      "default/zzz-last-by-slug",
      "default/aaa-first-by-slug",
    ]);
  });

  it("finds one rule by the project and slug its path names", async () => {
    await insertRule(harness().db, { project: "payments", slug: "latency" });
    await insertRule(harness().db, { project: "search", slug: "latency" });

    const rule = await loadRule(TEST_ORG, "payments/latency");

    expect(rulePath(rule)).toBe("payments/latency");
  });

  it("reports not found for a path no Alert rule has", async () => {
    await insertRule(harness().db, { slug: "checkout-latency" });

    await expect(loadRule(TEST_ORG, "default/no-such-rule")).rejects.toThrow();
  });

  it("reports not found for a Preview copy's path", async () => {
    const preview = await insertPreview(harness().db);
    await insertRule(harness().db, {
      slug: "preview-only",
      previewId: preview.id,
    });

    await expect(loadRule(TEST_ORG, "default/preview-only")).rejects.toThrow();
  });

  it("returns one rule's Alert instances, worst value first", async () => {
    const rule = await insertRule(harness().db, { slug: "checkout-latency" });
    await insertInstance(rule.id, { fingerprint: "middle", value: 50 });
    await insertInstance(rule.id, { fingerprint: "worst", value: 90 });
    await insertInstance(rule.id, { fingerprint: "best", value: 10 });

    const instances = await loadRuleInstances(TEST_ORG, rule.id);

    expect(instances.map((row) => row.fingerprint)).toEqual([
      "worst",
      "middle",
      "best",
    ]);
  });

  it("reads the Alert instances of the rules it was given, and no others", async () => {
    const asked = await insertRule(harness().db, { slug: "asked-about" });
    const other = await insertRule(harness().db, { slug: "not-asked-about" });
    await insertInstance(asked.id, { fingerprint: "wanted", value: 1 });
    await insertInstance(other.id, { fingerprint: "unwanted", value: 1 });

    const instances = await loadInstances(TEST_ORG, [asked.id]);

    expect(instances.map((row) => row.fingerprint)).toEqual(["wanted"]);
  });

  it("returns only the instance facts needed by the screens", async () => {
    const rule = await insertRule(harness().db);
    await insertInstance(rule.id, { fingerprint: "instance", value: 42 });
    const expected = [
      {
        alertDefinitionId: rule.id,
        fingerprint: "instance",
        status: "firing",
        value: 42,
        pendingSince: null,
        activeSince: null,
      },
    ];

    expect(await loadInstances(TEST_ORG, [rule.id])).toEqual(expected);
    expect(await loadRuleInstances(TEST_ORG, rule.id)).toEqual(expected);
  });

  it("asks the database nothing when it was given no rules", async () => {
    expect(await loadInstances(TEST_ORG, [])).toEqual([]);
  });
});
