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

import { loadUndeliveredRecords } from "./record";

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

function write(...rows: ReturnType<typeof journalTerminalRow>[]) {
  harness().clickhouse.write(rows);
}

describe("what reached delivery with nothing to carry it", () => {
  it("counts no-channel terminals per rule and severity, once per chain", async () => {
    write(
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

    const records = await loadUndeliveredRecords(query, windowOf(60));
    expect(records).toEqual([
      { path: PATH, severity: "warning", count: 2 },
      { path: "default/other", severity: "info", count: 1 },
    ]);
  });
});
