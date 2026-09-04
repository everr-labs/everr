// @vitest-environment node

/**
 * The default destination's read and write, against a real database: the
 * write resolves names to channel rows, keeps the two modes exclusive, and
 * the read gives the names back by tier.
 */
import { describe, expect, it, vi } from "vitest";
import {
  insertChannel,
  insertDefaultChannels,
  TEST_ACTOR,
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
  listDefaultDestination,
  setDefaultDestination,
  testChannel,
} from "./repository";

const harness = useAlertingHarness();
const scope = { organizationId: TEST_ORG, actor: TEST_ACTOR };

describe("the default destination", () => {
  it("reads back the names by tier, in name order", async () => {
    const oncall = await insertChannel(harness().db, { name: "#oncall" });
    const pager = await insertChannel(harness().db, {
      name: "pager",
      type: "webhook",
    });
    await insertDefaultChannels(harness().db, {
      tier: "critical",
      channelIds: [pager.id, oncall.id],
    });
    await insertDefaultChannels(harness().db, {
      tier: "warning",
      channelIds: [oncall.id],
    });

    expect(await listDefaultDestination(TEST_ORG)).toEqual({
      split: true,
      tiers: { critical: ["#oncall", "pager"], warning: ["#oncall"] },
    });
  });

  it("replaces the destination wholesale", async () => {
    const oncall = await insertChannel(harness().db, { name: "#oncall" });
    await insertChannel(harness().db, { name: "pager", type: "webhook" });
    await insertDefaultChannels(harness().db, {
      tier: "all",
      channelIds: [oncall.id],
    });

    const result = await setDefaultDestination(scope, {
      tiers: { critical: ["pager"], info: ["#oncall", "pager"] },
    });
    expect(result).toEqual({
      split: true,
      tiers: { critical: ["pager"], info: ["#oncall", "pager"] },
    });
    expect(await listDefaultDestination(TEST_ORG)).toEqual(result);
  });

  it("refuses a name no channel has, and leaves the record as it was", async () => {
    const oncall = await insertChannel(harness().db, { name: "#oncall" });
    await insertDefaultChannels(harness().db, {
      tier: "all",
      channelIds: [oncall.id],
    });

    await expect(
      setDefaultDestination(scope, { tiers: { all: ["#oncall", "#gone"] } }),
    ).rejects.toThrow(/Unknown channels: #gone/);
    expect(await listDefaultDestination(TEST_ORG)).toEqual({
      split: false,
      tiers: { all: ["#oncall"] },
    });
  });

  it("keeps the unsplit and the split modes exclusive", async () => {
    await insertChannel(harness().db, { name: "#oncall" });
    await expect(
      setDefaultDestination(scope, {
        tiers: { all: ["#oncall"], critical: ["#oncall"] },
      }),
    ).rejects.toThrow(/cannot be combined/);
  });

  it("an empty selection stops default delivery", async () => {
    const oncall = await insertChannel(harness().db, { name: "#oncall" });
    await insertDefaultChannels(harness().db, {
      tier: "all",
      channelIds: [oncall.id],
    });
    expect(
      await setDefaultDestination(scope, { split: false, tiers: {} }),
    ).toEqual({
      split: false,
      tiers: {},
    });
  });

  it("keeps split mode when every severity tier is empty", async () => {
    expect(
      await setDefaultDestination(scope, { split: true, tiers: {} }),
    ).toEqual({ split: true, tiers: {} });
    expect(await listDefaultDestination(TEST_ORG)).toEqual({
      split: true,
      tiers: {},
    });
  });
});

describe("testing a saved channel", () => {
  it("uses the stored secret with the draft's public fields", async () => {
    await insertChannel(harness().db, {
      name: "pager",
      type: "telegram",
      botToken: "stored-token",
      chatIds: ["old-chat"],
    });

    await expect(
      testChannel(TEST_ORG, {
        name: "pager",
        config: {
          type: "telegram",
          bot_token: "***",
          chat_ids: ["new-chat"],
        },
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(harness().fetchCalls()).toEqual([
      expect.objectContaining({
        url: "https://api.telegram.org/botstored-token/sendMessage",
        body: expect.objectContaining({ chat_id: "new-chat" }),
      }),
    ]);
  });
});
