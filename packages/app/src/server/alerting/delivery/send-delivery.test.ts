import { is, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockChannelSendError extends Error {
    readonly permanent: boolean;
    constructor(message: string, opts: { permanent: boolean }) {
      super(message);
      this.permanent = opts.permanent;
    }
  }
  return {
    deliveryRows: [] as unknown[],
    liveRules: [] as unknown[],
    set: vi.fn(),
    update: vi.fn(),
    where: vi.fn(),
    send: vi.fn(),
    outcome: vi.fn(),
    ChannelSendError: MockChannelSendError,
  };
});

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
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
  ChannelSendError: mocks.ChannelSendError,
}));
vi.mock("./history", () => ({ recordDeliveryOutcome: mocks.outcome }));

import { ALERT_DELIVERY_MAX_ATTEMPTS } from "@/data/alerting/delivery/config";
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

describe("sendAlertDelivery missing channel", () => {
  beforeEach(() => {
    mocks.deliveryRows = [deliveryRow];
    mocks.liveRules = [{ eventId: "e-1" }];
    mocks.send.mockReset().mockResolvedValue(undefined);
    mocks.outcome.mockReset().mockResolvedValue(undefined);
    mocks.where.mockReset().mockResolvedValue(undefined);
    mocks.set.mockReset().mockReturnValue({ where: mocks.where });
    mocks.update.mockReset().mockReturnValue({ set: mocks.set });
  });

  it("records a terminal failure when the channel was deleted before the send", async () => {
    // The left join keeps the delivery and drops the channel.
    mocks.deliveryRows = [{ ...deliveryRow, channel: null }];

    await sendAlertDelivery({ dedupKey: "dk-1" });

    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        attempts: ALERT_DELIVERY_MAX_ATTEMPTS,
      }),
    );
    // The journal entry is the point: returning silently here would leave a
    // notification that never arrived and never said why.
    expect(mocks.outcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failed",
        channelName: deliveryRow.delivery.channelName,
        error: expect.stringContaining("deleted"),
      }),
    );
  });
});

describe("sendAlertDelivery send failure", () => {
  beforeEach(() => {
    mocks.deliveryRows = [deliveryRow];
    mocks.liveRules = [{ eventId: "e-1" }];
    mocks.outcome.mockReset().mockResolvedValue(undefined);
    mocks.where.mockReset().mockResolvedValue(undefined);
    mocks.set.mockReset().mockReturnValue({ where: mocks.where });
    mocks.update.mockReset().mockReturnValue({ set: mocks.set });
  });

  it("guards the failure write so a racing sent row can never flip back to failed", async () => {
    mocks.send.mockReset().mockRejectedValue(new Error("boom"));

    await expect(sendAlertDelivery({ dedupKey: "dk-1" })).rejects.toThrow();

    const condition = mocks.where.mock.calls[0]?.[0] as SQL;
    const rendered = new PgDialect().sqlToQuery(condition);
    expect(rendered.sql).toContain('"status" <> ');
    expect(rendered.params).toContain("sent");
  });

  it("increments attempts in the database, not from the Node-side read", async () => {
    mocks.send.mockReset().mockRejectedValue(new Error("boom"));

    await expect(sendAlertDelivery({ dedupKey: "dk-1" })).rejects.toThrow();

    const [failedCall] = mocks.set.mock.calls.filter(
      (call) => call[0]?.status === "failed",
    );
    // An SQL fragment (`attempts + 1` computed by Postgres), not the plain
    // number read at the top of this run: two racing sends of the same
    // delivery must not both compute the same stale count.
    expect(is(failedCall?.[0].attempts, SQL)).toBe(true);
  });

  it("keeps the original send error when failDelivery's own write also throws", async () => {
    const sendError = new Error("provider rejected the request");
    mocks.send.mockReset().mockRejectedValue(sendError);
    // The failure bookkeeping write itself fails too.
    mocks.where.mockReset().mockRejectedValue(new Error("db unavailable"));

    let thrown: unknown;
    try {
      await sendAlertDelivery({ dedupKey: "dk-1" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const cause = (thrown as Error).cause as {
      sendError: Error;
      bookkeepingError: Error;
    };
    expect(cause.sendError.message).toBe(sendError.message);
  });
});

describe("sendAlertDelivery status write after a successful send", () => {
  beforeEach(() => {
    mocks.deliveryRows = [deliveryRow];
    mocks.liveRules = [{ eventId: "e-1" }];
    mocks.send.mockReset().mockResolvedValue(undefined);
    mocks.outcome.mockReset().mockResolvedValue(undefined);
    mocks.where.mockReset().mockResolvedValue(undefined);
    mocks.set.mockReset().mockReturnValue({ where: mocks.where });
    mocks.update.mockReset().mockReturnValue({ set: mocks.set });
  });

  it("does not classify the delivery failed when only the status write fails", async () => {
    mocks.where.mockReset().mockRejectedValue(new Error("db unavailable"));

    await expect(sendAlertDelivery({ dedupKey: "dk-1" })).rejects.toThrow();

    expect(mocks.send).toHaveBeenCalledOnce();
    // Never classified failed: the send succeeded, only the bookkeeping
    // write did not land.
    const failedCalls = mocks.set.mock.calls.filter(
      (call) => call[0]?.status === "failed",
    );
    expect(failedCalls).toHaveLength(0);
    expect(mocks.outcome).not.toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed" }),
    );
    // Retried once before giving up.
    expect(mocks.where).toHaveBeenCalledTimes(2);
  });
});
