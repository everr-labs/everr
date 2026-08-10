import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deliveryRows: [] as unknown[],
  liveRules: [] as unknown[],
  set: vi.fn(),
  update: vi.fn(),
  where: vi.fn(),
  send: vi.fn(),
  outcome: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () => Promise.resolve(mocks.deliveryRows),
          }),
        }),
      }),
    }),
    update: mocks.update,
  },
  pool: {},
}));
vi.mock("./journal-reader", () => ({
  liveRuleForDeliveryQuery: () => Promise.resolve(mocks.liveRules),
}));
vi.mock("@/data/alerting/delivery/channel-secrets.server", () => ({
  decryptChannelConfig: () => ({ type: "webhook", url: "https://hook" }),
}));
vi.mock("@/data/alerting/delivery/channel-sender.server", () => ({
  sendChannelNotification: mocks.send,
}));
vi.mock("./history", () => ({ recordDeliveryOutcome: mocks.outcome }));

import { sendAlertDelivery } from "./send-delivery";

const deliveryRow = {
  delivery: {
    dedupKey: "dk-1",
    organizationId: "org-1",
    channelId: "ch-1",
    channelName: "on-call",
    status: "pending",
    attempts: 0,
    notification: { title: "t", body: "b" },
  },
  channel: { id: "ch-1", encryptedConfig: "enc" },
};

describe("sendAlertDelivery rule liveness", () => {
  beforeEach(() => {
    mocks.deliveryRows = [deliveryRow];
    mocks.liveRules = [{ eventId: "e-1" }];
    mocks.send.mockReset().mockResolvedValue(undefined);
    mocks.outcome.mockReset().mockResolvedValue(undefined);
    mocks.where.mockReset().mockResolvedValue(undefined);
    mocks.set.mockReset().mockReturnValue({ where: mocks.where });
    mocks.update.mockReset().mockReturnValue({ set: mocks.set });
  });

  it("does not send when every rule behind the notification is paused or deleted", async () => {
    mocks.liveRules = [];

    await sendAlertDelivery({ dedupKey: "dk-1" });

    expect(mocks.send).not.toHaveBeenCalled();
    // Failed permanently, not thrown: a retry can never revive the rule.
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
    expect(mocks.outcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failed",
        error: expect.stringContaining("paused"),
      }),
    );
  });

  it("sends while at least one rule behind the notification is active", async () => {
    await sendAlertDelivery({ dedupKey: "dk-1" });

    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent" }),
    );
    expect(mocks.outcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "succeeded" }),
    );
  });
});
