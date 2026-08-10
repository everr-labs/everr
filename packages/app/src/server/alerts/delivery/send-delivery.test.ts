import { is, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
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

import { ALERT_DELIVERY_MAX_ATTEMPTS } from "./config";
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
    // Attempts pinned at the max, not incremented from the current count: the
    // retention sweep and the terminal-cleanup index only treat a failed row
    // as done once attempts >= ALERT_DELIVERY_MAX_ATTEMPTS, or this row (and
    // the journal events it links) would never become eligible for cleanup.
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ attempts: ALERT_DELIVERY_MAX_ATTEMPTS }),
    );
    expect(mocks.outcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failed",
        // The real channel type, not the "unknown" placeholder: the trail's
        // delivery_targets keys on it.
        channelType: "webhook",
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

describe("sendAlertDelivery send failure", () => {
  beforeEach(() => {
    mocks.deliveryRows = [deliveryRow];
    mocks.liveRules = [{ eventId: "e-1" }];
    mocks.outcome.mockReset().mockResolvedValue(undefined);
    mocks.where.mockReset().mockResolvedValue(undefined);
    mocks.set.mockReset().mockReturnValue({ where: mocks.where });
    mocks.update.mockReset().mockReturnValue({ set: mocks.set });
  });

  it("sanitizes the webhook url out of last_error before it reaches Postgres", async () => {
    mocks.send
      .mockReset()
      .mockRejectedValue(
        new Error(
          "notification webhook failed: 500 at https://hooks.slack.com/services/T0/B0/SECRET",
        ),
      );

    await expect(sendAlertDelivery({ dedupKey: "dk-1" })).rejects.toThrow();

    const [failedCall] = mocks.set.mock.calls.filter(
      (call) => call[0]?.status === "failed",
    );
    expect(failedCall?.[0].lastError).not.toContain("SECRET");
    expect(failedCall?.[0].lastError).toContain("[redacted-url]");
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

  it("records the succeeded outcome once the status write lands", async () => {
    await sendAlertDelivery({ dedupKey: "dk-1" });

    expect(mocks.outcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "succeeded" }),
    );
    const sentCall = mocks.set.mock.calls.find(
      (call) => call[0]?.status === "sent",
    );
    expect(sentCall).toBeDefined();
  });
});
