import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
vi.mock("@/lib/mailer.server", () => ({
  mailer: { send: (...args: unknown[]) => sendEmail(...args) },
}));

const sendTelegram = vi.fn();
vi.mock("@/lib/telegram.server", () => ({
  sendTelegramMessage: (...args: unknown[]) => sendTelegram(...args),
}));

const insertEvents = vi.fn();
vi.mock("@/lib/clickhouse", () => ({
  insertAlertEvents: (...args: unknown[]) => insertEvents(...args),
}));

const settingsRows = vi.fn();
const silenceRows = vi.fn();
const select = vi.fn();
vi.mock("@/db/client", () => ({
  db: {
    select: () => select(),
  },
}));

vi.mock("@/telemetry/logger", () => ({
  exceptionAttributes: (error: unknown) => ({
    "exception.message": error instanceof Error ? error.message : String(error),
  }),
  serverLogger: { error: vi.fn() },
}));

import { deliverAlertNotification } from "./delivery";

const def = { id: "a1", organizationId: "org-1", repoid: "r1", slug: "s1" };

function makeSelectChain(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  select.mockReset();
  settingsRows.mockReset();
  silenceRows.mockReset();
  sendTelegram.mockResolvedValue(undefined);
  insertEvents.mockResolvedValue(undefined);
  settingsRows.mockReturnValue([
    {
      delivery: {
        email: { enabled: true, to: ["a@example.com"] },
        telegram: { enabled: true, chatIds: ["123"] },
      },
    },
  ]);
  silenceRows.mockReturnValue([]);
  select.mockImplementationOnce(() => makeSelectChain(settingsRows()));
  select.mockImplementationOnce(() => makeSelectChain(silenceRows()));
});

describe("deliverAlertNotification", () => {
  it("sends email and telegram for firing and records sent attempts", async () => {
    await deliverAlertNotification({
      def,
      kind: "firing",
      summary: "3 bad",
      description: "",
    });

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@example.com",
        subject: expect.stringContaining("s1"),
      }),
    );
    expect(sendTelegram).toHaveBeenCalledWith(
      "123",
      expect.stringContaining("3 bad"),
    );
    expect(insertEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          delivery_target_type: "email",
          delivery_outcome: "sent",
        }),
        expect.objectContaining({
          delivery_target_type: "telegram",
          delivery_outcome: "sent",
        }),
      ]),
    );
  });

  it("suppresses delivery under an active silence and records silenced attempts", async () => {
    silenceRows.mockReturnValue([{ id: "sil-1" }]);

    await deliverAlertNotification({
      def,
      kind: "firing",
      summary: "x",
      description: "",
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(insertEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          delivery_outcome: "silenced",
          silence_id: "sil-1",
        }),
      ]),
    );
  });

  it("skips resolved delivery unless notifyOnResolved is enabled", async () => {
    await deliverAlertNotification({
      def,
      kind: "resolved",
      summary: "ok",
      description: "",
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(insertEvents).not.toHaveBeenCalled();
  });

  it("records failed attempts without throwing", async () => {
    sendTelegram.mockRejectedValue(new Error("nope"));

    await deliverAlertNotification({
      def,
      kind: "firing",
      summary: "x",
      description: "",
    });

    expect(insertEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          delivery_target_type: "telegram",
          delivery_outcome: "failed",
        }),
      ]),
    );
  });
});
