import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { ALERTING_DEFAULT_GROUP_WAIT_SECS } from "@/data/alerting/delivery/defaults";
import { setTestDatabase } from "./db-proxy";
import { failedJobs, pendingJobs, runDueJobs } from "./job-driver";
import { createTestDatabase, type TestDatabase } from "./pglite-database";
import { activeClickHouse, type TestClickHouse } from "./test-clickhouse";

type FetchResponse = { status: number; body?: string };
type FetchResponder = FetchResponse | ((url: string) => FetchResponse);

export interface AlertingHarness {
  db: TestDatabase["db"];
  clickhouse: TestClickHouse;
  fetchCalls(): { url: string; body: unknown }[];
  setFetchResponse(responder: FetchResponder): void;
  runDueJobs(opts?: { limit?: number }): Promise<number>;
  pendingJobs(): ReturnType<typeof pendingJobs>;
  failedJobs(): ReturnType<typeof failedJobs>;
  setNow(when: Date): void;
  advance(ms: number): void;
  /**
   * The two drains a notification always needs, with the group wait between
   * them. No dispatch is immediate: even a rule wired straight to a channel
   * waits `ALERTING_DEFAULT_GROUP_WAIT_SECS`, so the first drain only fires
   * and enqueues, and nothing is sent until the wait elapses and the flush
   * claims the group.
   */
  fireAndFlush(): Promise<void>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createAlertingHarness(): Promise<AlertingHarness> {
  // Fake Date only, not the whole timer set: PGlite boots a WebAssembly
  // runtime and awaits real timers while doing so, so a fully faked clock
  // (setTimeout, setInterval, queueMicrotask, ...) stops that boot from ever
  // completing. Date is all setNow/advance below need, and PostgreSQL reads
  // it too: installFakeClock shadows the database's now() with this clock.
  vi.useFakeTimers({ toFake: ["Date"] });
  const database = await createTestDatabase();
  setTestDatabase(database.db);

  let responder: FetchResponder = { status: 200, body: "ok" };
  const calls: { url: string; body: unknown }[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      let body: unknown = init?.body;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          // A provider that posts form-encoded text keeps its raw string.
        }
      }
      calls.push({ url, body });
      const response =
        typeof responder === "function" ? responder(url) : responder;
      return new Response(response.body ?? "", { status: response.status });
    }),
  );

  return {
    db: database.db,
    clickhouse: activeClickHouse,
    fetchCalls: () => calls,
    setFetchResponse(next) {
      responder = next;
    },
    runDueJobs: (opts) => runDueJobs(database.db, opts),
    pendingJobs: () => pendingJobs(database.db),
    failedJobs: () => failedJobs(database.db),
    setNow(when) {
      vi.setSystemTime(when);
    },
    advance(ms) {
      vi.setSystemTime(new Date(Date.now() + ms));
    },
    async fireAndFlush() {
      await runDueJobs(database.db);
      vi.setSystemTime(
        new Date(Date.now() + ALERTING_DEFAULT_GROUP_WAIT_SECS * 1_000),
      );
      await runDueJobs(database.db);
    },
    async reset() {
      await database.truncate();
      activeClickHouse.reset();
      calls.length = 0;
      responder = { status: 200, body: "ok" };
    },
    async close() {
      activeClickHouse.close();
      setTestDatabase(undefined);
      vi.unstubAllGlobals();
      vi.useRealTimers();
      await database.close();
    },
  };
}

/** The clock every harnessed test file starts from. */
const TEST_CLOCK_START = new Date("2026-01-01T00:00:00Z");

/**
 * Register the lifecycle a harnessed test file needs, and give back a getter
 * for the harness itself.
 *
 * The harness owns the fake clock: it installs a Date-only fake timer on
 * create and restores real timers on close. Faking the whole timer set would
 * hang PGlite's WebAssembly boot, so no test file installs its own.
 *
 * Keep the `vi.mock` calls in the test file. Vitest hoists them to the top of
 * the file that holds them, so a mock moved in here does not apply.
 */
export function useAlertingHarness(): () => AlertingHarness {
  let harness: AlertingHarness | undefined;

  beforeAll(async () => {
    harness = await createAlertingHarness();
  }, 60_000);

  beforeEach(() => {
    harness?.setNow(TEST_CLOCK_START);
  });

  afterEach(async () => {
    await harness?.reset();
  });

  afterAll(async () => {
    await harness?.close();
    harness = undefined;
  });

  return () => {
    if (!harness) {
      throw new Error("The alerting harness is not ready yet.");
    }
    return harness;
  };
}
