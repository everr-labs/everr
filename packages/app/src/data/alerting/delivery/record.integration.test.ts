// @vitest-environment node

/**
 * The Notifications page's ClickHouse reads, against a real engine (chdb,
 * running the shipped `app.alert_events` DDL). Rows are built by the
 * production writers in `server/alerting/history/clickhouse.ts` and put in
 * directly, the way `triage/history.integration.test.ts` does it.
 */
import { describe, expect, it, vi } from "vitest";
import { uuidv7 } from "@/data/alerting/history/ids";
import {
  type AlertHistoryDefinition,
  type AlertHistoryRow,
  deliveryHistoryRow,
  journalTerminalRow,
} from "@/server/alerting/history/clickhouse";
import { TEST_ORG } from "@/server/alerting/testing/fixtures";
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

import { loadDeliveryRecords } from "./record";

const harness = useAlertingHarness();

const MINUTE = 60_000;
const PATH = "default/checkout-latency";

const query = async <T>(sql: string, params?: Record<string, unknown>) =>
  harness().clickhouse.read<T>(sql, params).rows;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE);
}

function windowOf(fromMinutes: number, toMinutes = 0) {
  return {
    fromISO: minutesAgo(fromMinutes).toISOString(),
    toISO: minutesAgo(toMinutes).toISOString(),
  };
}

function definition(
  overrides: Partial<AlertHistoryDefinition> = {},
): AlertHistoryDefinition {
  return {
    id: "8b2f2f5e-1f2a-4d8b-9a3c-2f6b1c4d5e60",
    organizationId: TEST_ORG,
    repoid: "repo_test",
    slug: PATH,
    previewId: null,
    severity: "warning",
    ruleMuted: false,
    ...overrides,
  };
}

/** One delivery outcome row, for one notification riding in one send. */
function delivery(opts: {
  channel: string;
  type?: string;
  dedupKey: string;
  at: Date;
  outcome: "succeeded" | "failed";
  error?: string;
  fingerprint?: string;
  def?: AlertHistoryDefinition;
}): AlertHistoryRow {
  return deliveryHistoryRow({
    def: opts.def ?? definition(),
    notificationEventId: uuidv7(opts.at),
    dedupKey: opts.dedupKey,
    outcomeAt: opts.at,
    fingerprint: opts.fingerprint ?? "a",
    labels: { host: opts.fingerprint ?? "a" },
    deliveryTargets: { [opts.type ?? "slack"]: [opts.channel] },
    outcome: opts.outcome,
    ...(opts.error === undefined ? {} : { error: opts.error }),
  });
}

/** The chain a terminal points back at; its stamp places the row in time. */
function chain(at: Date, overrides: { slug?: string; severity?: string } = {}) {
  return {
    id: uuidv7(at),
    sourceDefinitionId: definition().id,
    organizationId: TEST_ORG,
    repoid: "repo_test",
    slug: overrides.slug ?? PATH,
    previewId: null,
    severity: overrides.severity ?? "warning",
    suppressed: false,
    instanceFingerprint: "a",
    instanceLabels: { host: "a" },
  };
}

function write(...rows: AlertHistoryRow[]) {
  harness().clickhouse.write(rows);
}

describe("what each channel delivered in the window", () => {
  it("counts sends, not the instances that rode in them", async () => {
    const at = minutesAgo(10);
    const later = minutesAgo(5);
    write(
      delivery({
        channel: "#oncall",
        dedupKey: "d1",
        at,
        fingerprint: "a",
        outcome: "succeeded",
      }),
      delivery({
        channel: "#oncall",
        dedupKey: "d1",
        at,
        fingerprint: "b",
        outcome: "succeeded",
      }),
      delivery({
        channel: "#oncall",
        dedupKey: "d2",
        at: later,
        outcome: "succeeded",
      }),
    );

    const [record] = (await loadDeliveryRecords(query, windowOf(60))).channels;
    expect(record).toMatchObject({ channel: "#oncall", sent: 2, failed: 0 });
    expect(record?.lastSentAt).toBe(later.toISOString());
  });

  it("counts a send that got through after a failed attempt as sent", async () => {
    write(
      delivery({
        channel: "pager",
        type: "webhook",
        dedupKey: "d1",
        at: minutesAgo(10),
        outcome: "failed",
        error: "HTTP 429",
      }),
      delivery({
        channel: "pager",
        type: "webhook",
        dedupKey: "d1",
        at: minutesAgo(9),
        outcome: "succeeded",
      }),
      delivery({
        channel: "pager",
        type: "webhook",
        dedupKey: "d2",
        at: minutesAgo(8),
        outcome: "failed",
        error: "HTTP 500",
      }),
    );

    const [record] = (await loadDeliveryRecords(query, windowOf(60))).channels;
    expect(record).toMatchObject({
      channel: "pager",
      sent: 1,
      failed: 1,
      lastError: "HTTP 500",
    });
  });

  it("ranges a recovered send by when it succeeded, not when it was queued", async () => {
    const failed = minutesAgo(20);
    const succeeded = minutesAgo(10);
    write(
      delivery({
        channel: "pager",
        type: "webhook",
        dedupKey: "d1",
        at: failed,
        outcome: "failed",
        error: "HTTP 429",
      }),
      delivery({
        channel: "pager",
        type: "webhook",
        dedupKey: "d1",
        at: succeeded,
        outcome: "succeeded",
      }),
    );

    const [record] = (await loadDeliveryRecords(query, windowOf(60))).channels;
    expect(record).toMatchObject({ channel: "pager", sent: 1, failed: 0 });
    expect(record?.lastSentAt).toBe(succeeded.toISOString());
  });

  it("gives a channel that only failed no last-sent time", async () => {
    write(
      delivery({
        channel: "pager",
        type: "webhook",
        dedupKey: "d1",
        at: minutesAgo(8),
        outcome: "failed",
        error: "HTTP 500",
      }),
    );
    const [record] = (await loadDeliveryRecords(query, windowOf(60))).channels;
    expect(record).toMatchObject({ sent: 0, failed: 1, lastSentAt: null });
  });

  it("reads only the window, and every channel a send reached", async () => {
    write(
      delivery({
        channel: "#oncall",
        dedupKey: "old",
        at: minutesAgo(120),
        outcome: "succeeded",
      }),
      delivery({
        channel: "#oncall",
        dedupKey: "d1",
        at: minutesAgo(10),
        outcome: "succeeded",
      }),
      delivery({
        channel: "pager",
        type: "webhook",
        dedupKey: "d2",
        at: minutesAgo(10),
        outcome: "succeeded",
      }),
    );
    const records = (await loadDeliveryRecords(query, windowOf(60))).channels;
    expect(records.map((r) => [r.channel, r.sent])).toEqual([
      ["#oncall", 1],
      ["pager", 1],
    ]);
  });
});

describe("what reached delivery with nothing to carry it", () => {
  it("counts no-channel terminals per rule and severity, once per chain", async () => {
    write(
      // A delivery on the same rule: the rule grain must not count it.
      delivery({
        channel: "#oncall",
        dedupKey: "d1",
        at: minutesAgo(11),
        outcome: "succeeded",
      }),
      journalTerminalRow(chain(minutesAgo(10)), { reason: "no_channels" }),
      journalTerminalRow(chain(minutesAgo(9)), { reason: "no_channels" }),
      journalTerminalRow(
        chain(minutesAgo(8), { slug: "default/other", severity: "info" }),
        { reason: "no_channels" },
      ),
      // Ended for another reason: not a delivery gap.
      journalTerminalRow(chain(minutesAgo(7)), { reason: "no_longer_firing" }),
      // Outside the window.
      journalTerminalRow(chain(minutesAgo(120)), { reason: "no_channels" }),
    );

    const records = (await loadDeliveryRecords(query, windowOf(60)))
      .undelivered;
    expect(records).toEqual([
      { path: PATH, severity: "warning", count: 2 },
      { path: "default/other", severity: "info", count: 1 },
    ]);
  });
});
