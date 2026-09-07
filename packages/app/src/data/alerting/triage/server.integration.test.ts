// @vitest-environment node

/**
 * The three reads the Triage screen makes, end to end, against real engines.
 *
 * The loaders beside this file are covered one at a time, and `assemble.ts` is
 * covered on hand-built inputs. What is only visible here is the wiring: which
 * Alert rules each read asks ClickHouse about, which window it asks over, and
 * how the detail names the lanes on its chart. These cases assert on
 * structure, never on printed text, because printed text is `assemble.ts`'s
 * job and a bug there would then fail twice.
 *
 * The Organization is `test_org`: the session these server functions run with
 * comes from the global mock in `src/test-setup.ts`.
 *
 * As in every ClickHouse suite here, nothing below claims Tenant isolation
 * (chdb has no row policy) or anything about ClickHouse 26.4 (chdb is 26.7).
 */
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AlertingEvaluationSample } from "@/data/alerting/types";
import { alertDefinitions, alertInstances } from "@/db/schema";
import {
  type AlertHistoryDefinition,
  evaluationHistoryRow,
} from "@/server/alerting/history/clickhouse";
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

import { getAlertDetail, getAlertTriage, getRuleStateHistory } from "./server";

const harness = useAlertingHarness();

const SESSION_ORG = "test_org";
const MINUTE = 60_000;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE);
}

/** The picked time range, spelled the way the browser sends it. */
function range(fromMinutes: number) {
  return {
    from: minutesAgo(fromMinutes).toISOString(),
    to: new Date().toISOString(),
  };
}

/** An Alert rule with a state, plus one tracked Alert instance when it has
 *  one. `insertRule` mirrors production's create, which leaves a rule quiet. */
async function rule(opts: {
  slug: string;
  state?: "unknown" | "firing" | "pending";
  value?: number;
}) {
  const row = await insertRule(harness().db, {
    organizationId: SESSION_ORG,
    slug: opts.slug,
  });
  if (opts.state && opts.state !== "unknown") {
    await harness()
      .db.update(alertDefinitions)
      .set({
        currentState: opts.state,
        firingInstanceCount: 1,
        lastRowCount: 1,
      })
      .where(eq(alertDefinitions.id, row.id));
    await harness()
      .db.insert(alertInstances)
      .values({
        organizationId: SESSION_ORG,
        alertDefinitionId: row.id,
        fingerprint: "a",
        status: opts.state,
        labels: { host: "web-1" },
        value: opts.value ?? 90,
        activeSince: minutesAgo(30),
        pendingSince: minutesAgo(35),
      });
  }
  return { ...row, path: `default/${opts.slug}` };
}

function historyDef(slug: string): AlertHistoryDefinition {
  return {
    id: "8b2f2f5e-1f2a-4d8b-9a3c-2f6b1c4d5e60",
    organizationId: SESSION_ORG,
    repoid: "repo_test",
    slug: `default/${slug}`,
    previewId: null,
    severity: "warning",
    ruleMuted: false,
  };
}

/** One successful evaluation of a rule, with the series it measured. */
function evaluated(
  slug: string,
  at: Date,
  samples: AlertingEvaluationSample[],
) {
  harness().clickhouse.write([
    evaluationHistoryRow({
      def: historyDef(slug),
      scheduledFor: at,
      occurredAt: at,
      rowCount: samples.length,
      evidenceJson: "{}",
      evidenceTruncated: false,
      samples,
      samplesTruncated: false,
    }),
  ]);
}

const sample = (fingerprint: string, value: number): AlertingEvaluationSample =>
  ({ fingerprint, labels: { host: fingerprint }, value }) as never;

describe("the Triage board", () => {
  it("lists only the Alert rules that need attention, each with its own lanes", async () => {
    const firing = await rule({ slug: "firing-rule", state: "firing" });
    const quiet = await rule({ slug: "quiet-rule" });
    evaluated("firing-rule", minutesAgo(10), [sample("a", 90)]);
    evaluated("quiet-rule", minutesAgo(10), [sample("a", 1)]);

    const board = await getAlertTriage({ data: range(60) });

    expect(board.alerts.map((alert) => alert.path)).toEqual([firing.path]);
    expect(
      board.alerts[0].spark.instances.map((lane) => lane.fingerprint),
    ).toEqual(["a"]);
    // The quiet rule is still in the inventory beside the board.
    expect(board.rules.map((row) => row.path).sort()).toEqual(
      [firing.path, quiet.path].sort(),
    );
  });

  it("measures the lanes over the picked window, not a fixed one", async () => {
    await rule({ slug: "firing-rule", state: "firing" });
    evaluated("firing-rule", minutesAgo(5), [sample("a", 90)]);
    evaluated("firing-rule", minutesAgo(200), [sample("a", 10)]);

    const narrow = await getAlertTriage({ data: range(60) });
    const wide = await getAlertTriage({ data: range(600) });

    expect(narrow.alerts[0].spark.window.minutes).toBe(60);
    expect(wide.alerts[0].spark.window.minutes).toBe(600);
    // The older reading is outside the narrow window and inside the wide one.
    expect(narrow.alerts[0].spark.instances[0].points).toHaveLength(1);
    expect(wide.alerts[0].spark.instances[0].points).toHaveLength(2);
  });
});

describe("the state chart behind the inventory", () => {
  it("has an entry for every live Alert rule, quiet ones included", async () => {
    const firing = await rule({ slug: "firing-rule", state: "firing" });
    const quiet = await rule({ slug: "quiet-rule" });
    evaluated("quiet-rule", minutesAgo(10), [sample("a", 1)]);

    const history = await getRuleStateHistory({ data: range(60) });

    expect(Object.keys(history.rules).sort()).toEqual(
      [firing.path, quiet.path].sort(),
    );
    // A quiet rule has no segments to paint, and still carries what its
    // instances measured, so the chart's tooltip can name them.
    expect(history.rules[quiet.path].segments).toEqual([]);
    expect(
      history.rules[quiet.path].instances.map((lane) => lane.fingerprint),
    ).toEqual(["a"]);
  });
});

describe("one Alert rule's detail", () => {
  it("names a lane for an Alert instance the window saw but the last evaluation did not", async () => {
    const target = await rule({ slug: "checkout-latency", state: "firing" });
    // Earlier in the window: two series. The instance `gone` stopped being
    // returned before the last evaluation ran.
    evaluated("checkout-latency", minutesAgo(40), [
      sample("a", 90),
      sample("gone", 70),
    ]);
    evaluated("checkout-latency", minutesAgo(2), [sample("a", 95)]);

    const detail = await getAlertDetail({
      data: { path: target.path, ...range(60) },
    });

    const lanes = new Map(
      detail.instanceValues.map((lane) => [lane.fingerprint, lane.labels]),
    );
    // Both are named, and neither falls back to a bare fingerprint.
    expect(lanes.get("a")).toBe("host=a");
    expect(lanes.get("gone")).toBe("host=gone");
  });

  it("reports not found for a path no Alert rule has", async () => {
    await rule({ slug: "checkout-latency", state: "firing" });

    await expect(
      getAlertDetail({ data: { path: "default/no-such-rule", ...range(60) } }),
    ).rejects.toThrow();
  });
});
