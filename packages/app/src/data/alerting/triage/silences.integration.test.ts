// @vitest-environment node

/**
 * The Triage screen's PostgreSQL reads of Silences, against a real engine.
 *
 * Two things here can only be answered by a database: which clock the "still
 * open" test runs on, and where the window bounds actually fall. `now()` is
 * evaluated by PostgreSQL, not by the caller, and the harness shadows it with
 * the suite's own clock so a case can place a Silence on either side of it.
 */
import { describe, expect, it, vi } from "vitest";
import {
  insertRule,
  insertSilence,
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
  loadOpenSilences,
  loadSilencesForPage,
  loadSilencesInWindow,
} from "@/data/alerting/silences/repository";
import { silenceFor, silenceRecord } from "./silences";

const harness = useAlertingHarness();

const HOUR = 3_600_000;
const RULE_ID = "0e1c2b8f-4a3d-4c2b-9f11-5a7c9d2e8b41";

/** What that id resolves to for the screens. */
const RULE_PATH = "default/checkout-latency";

/** The lookup a screen hands the record builder. */
const rulePathFor = (id: string) => (id === RULE_ID ? RULE_PATH : null);

/** Selects the whole Alert rule, the way the Triage screen writes a Silence. */
const ruleMatcher = [{ label: "rule", op: "eq" as const, value: RULE_ID }];

function at(hoursFromNow: number): Date {
  return new Date(Date.now() + hoursFromNow * HOUR);
}

describe("the Silences the Triage screen reads", () => {
  it("leaves out a Silence whose window has already closed", async () => {
    const open = await insertSilence(harness().db, {
      startsAt: at(-2),
      endsAt: at(1),
    });
    await insertSilence(harness().db, { startsAt: at(-4), endsAt: at(-1) });

    const silences = await loadOpenSilences(TEST_ORG);

    expect(silences.map((row) => row.id)).toEqual([open.id]);
  });

  it("keeps a Silence that has not started, and does not yet attribute it", async () => {
    const scheduled = await insertSilence(harness().db, {
      startsAt: at(1),
      endsAt: at(2),
      matchers: ruleMatcher,
    });

    const silences = await loadOpenSilences(TEST_ORG);

    // Open by the window test, so a caller can list it as scheduled...
    expect(silences.map((row) => row.id)).toEqual([scheduled.id]);
    // ...but nothing is muted until it starts.
    expect(silenceFor(RULE_ID, "warning", silences, new Date())).toBeNull();
  });

  it("takes each window bound on its own", async () => {
    const from = at(-1);
    const to = new Date(Date.now());
    const endedInside = await insertSilence(harness().db, {
      startsAt: at(-3),
      endsAt: at(-0.5),
      matchers: ruleMatcher,
    });
    const spansTheWindow = await insertSilence(harness().db, {
      startsAt: at(-3),
      endsAt: at(3),
      matchers: ruleMatcher,
    });
    // Closed before the window opened.
    await insertSilence(harness().db, {
      startsAt: at(-5),
      endsAt: at(-4),
      matchers: ruleMatcher,
    });
    // Opens after the window closed.
    await insertSilence(harness().db, {
      startsAt: at(1),
      endsAt: at(2),
      matchers: ruleMatcher,
    });

    const silences = await loadSilencesInWindow(
      TEST_ORG,
      RULE_ID,
      "warning",
      from,
      to,
    );

    expect(new Set(silences.map((row) => row.id))).toEqual(
      new Set([endedInside.id, spansTheWindow.id]),
    );
  });

  it("returns the Silences that overlapped the window newest first", async () => {
    const older = await insertSilence(harness().db, {
      startsAt: at(-3),
      endsAt: at(1),
      matchers: ruleMatcher,
    });
    const newer = await insertSilence(harness().db, {
      startsAt: at(-1),
      endsAt: at(1),
      matchers: ruleMatcher,
    });

    const silences = await loadSilencesInWindow(
      TEST_ORG,
      RULE_ID,
      "warning",
      at(-4),
      at(0),
    );

    expect(silences.map((row) => row.id)).toEqual([newer.id, older.id]);
  });

  it("leaves out a Silence whose Matchers do not select the rule", async () => {
    const mine = await insertSilence(harness().db, {
      startsAt: at(-1),
      endsAt: at(1),
      matchers: ruleMatcher,
    });
    await insertSilence(harness().db, {
      startsAt: at(-1),
      endsAt: at(1),
      matchers: [{ label: "rule", op: "eq", value: "default/some-other-rule" }],
    });

    const silences = await loadSilencesInWindow(
      TEST_ORG,
      RULE_ID,
      "warning",
      at(-2),
      at(0),
    );

    expect(silences.map((row) => row.id)).toEqual([mine.id]);
  });

  it("selects a Silence written against the rule's Severity", async () => {
    await insertRule(harness().db, { slug: "checkout-latency" });
    const bySeverity = await insertSilence(harness().db, {
      startsAt: at(-1),
      endsAt: at(1),
      matchers: [{ label: "severity", op: "eq", value: "critical" }],
    });

    const critical = await loadSilencesInWindow(
      TEST_ORG,
      RULE_ID,
      "critical",
      at(-2),
      at(0),
    );
    const warning = await loadSilencesInWindow(
      TEST_ORG,
      RULE_ID,
      "warning",
      at(-2),
      at(0),
    );

    expect(critical.map((row) => row.id)).toEqual([bySeverity.id]);
    expect(warning).toEqual([]);
  });
});

describe("the Silences the Silences page lists", () => {
  it("keeps every open Silence and only the closed ones that overlap the range", async () => {
    const active = await insertSilence(harness().db, {
      startsAt: at(-2),
      endsAt: at(1),
    });
    // Open, but a week away from the range asked about.
    const scheduled = await insertSilence(harness().db, {
      startsAt: at(24 * 7),
      endsAt: at(24 * 7 + 1),
    });
    const closedInRange = await insertSilence(harness().db, {
      startsAt: at(-5),
      endsAt: at(-4),
    });
    await insertSilence(harness().db, { startsAt: at(-30), endsAt: at(-29) });

    const silences = await loadSilencesForPage(TEST_ORG, at(-6), at(0));

    expect(silences.map((row) => row.id).sort()).toEqual(
      [active.id, scheduled.id, closedInRange.id].sort(),
    );
  });

  it("prints the rule as one matcher among the others, and names it for a repeat", async () => {
    const { id } = await insertSilence(harness().db, {
      matchers: [...ruleMatcher, { label: "region", op: "eq", value: "eu" }],
      startsAt: at(-2),
      endsAt: at(1),
    });
    const rows = await loadSilencesForPage(TEST_ORG, at(-1), at(0));
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error("silence not listed");

    const page = silenceRecord(
      row,
      new Date(),
      { held: 2, dropped: 0 },
      rulePathFor,
    );

    expect(page.state).toBe("active");
    expect(page.matchers).toBe(`rule=${RULE_ID} region=eu`);
    expect(page.rule).toBe(RULE_PATH);
    expect(page.scope).toBe("region=eu");
    expect(page.impact).toBe("held 2");
  });

  it("has no rule to repeat when the Silence named none", async () => {
    const { id } = await insertSilence(harness().db, {
      matchers: [{ label: "environment", op: "eq", value: "staging" }],
      startsAt: at(-2),
      endsAt: at(1),
    });
    const rows = await loadSilencesForPage(TEST_ORG, at(-1), at(0));
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error("silence not listed");

    const page = silenceRecord(
      row,
      new Date(),
      { held: 0, dropped: 0 },
      rulePathFor,
    );

    expect(page.rule).toBeNull();
    expect(page.matchers).toBe("environment=staging");
    expect(page.scope).toBe("environment=staging");
    expect(page.impact).toBeNull();
  });
});
