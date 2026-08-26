import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

// Only so that importing the options for their keys does not build a real
// database pool: `server.ts` reaches the database, and nothing here calls it.
vi.mock("@/db/client", () => ({
  db: {},
  pool: {},
  runInTransaction: () => Promise.resolve(),
}));

import {
  alertDetailOptions,
  alertTriageOptions,
  invalidateAlertTriage,
  ruleStateHistoryOptions,
} from "./options";
import type { AlertDetail } from "./view";

const RANGE = { from: "now-1h", to: "now" };
const OTHER_RANGE = { from: "now-24h", to: "now" };
const PATH = "default/checkout-latency";

/** A client holding all three queries, each already answered, so a later
 *  invalidation has something to mark. */
function seededClient() {
  const client = new QueryClient();
  client.setQueryData(alertTriageOptions(RANGE).queryKey, {
    alerts: [],
    rules: [],
  });
  client.setQueryData(ruleStateHistoryOptions(RANGE).queryKey, {
    window: { minutes: 60, endsAt: 0 },
    rules: {},
  });
  // Only the identifying field: nothing here reads the detail's contents, and
  // a full AlertDetail would be twenty fields of noise.
  client.setQueryData(alertDetailOptions(PATH, RANGE).queryKey, {
    path: PATH,
  } as AlertDetail);
  return client;
}

const isStale = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryCache().find({ queryKey: key })?.isStaleByTime(Infinity) ??
  false;

describe("the Triage screen's queries", () => {
  it("invalidates the board, the state history and the detail together", async () => {
    const client = seededClient();
    const keys = [
      alertTriageOptions(RANGE).queryKey,
      ruleStateHistoryOptions(RANGE).queryKey,
      alertDetailOptions(PATH, RANGE).queryKey,
    ];
    expect(keys.map((key) => isStale(client, key))).toEqual([
      false,
      false,
      false,
    ]);

    await invalidateAlertTriage(client);

    // A mutation changes what all three are reading, so one call has to reach
    // all three. A caller that spelt a key out again would keep compiling and
    // quietly stop refreshing.
    expect(keys.map((key) => isStale(client, key))).toEqual([true, true, true]);
  });

  it("gives two time ranges two keys, so a range change cannot serve the old window", () => {
    expect(alertTriageOptions(RANGE).queryKey).not.toEqual(
      alertTriageOptions(OTHER_RANGE).queryKey,
    );
    expect(ruleStateHistoryOptions(RANGE).queryKey).not.toEqual(
      ruleStateHistoryOptions(OTHER_RANGE).queryKey,
    );
    expect(alertDetailOptions(PATH, RANGE).queryKey).not.toEqual(
      alertDetailOptions(PATH, OTHER_RANGE).queryKey,
    );
  });

  it("keeps two Alert rules' details apart", () => {
    expect(alertDetailOptions(PATH, RANGE).queryKey).not.toEqual(
      alertDetailOptions("default/other-rule", RANGE).queryKey,
    );
  });

  it("asks for nothing until an Alert rule is selected", () => {
    expect(alertDetailOptions(undefined, RANGE).enabled).toBe(false);
    expect(alertDetailOptions(PATH, RANGE).enabled).toBe(true);
  });
});
