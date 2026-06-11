import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
vi.mock("@/lib/mailer.server", () => ({
  mailer: { send: (...args: unknown[]) => sendEmail(...args) },
}));

const sendTelegram = vi.fn();
vi.mock("@/lib/telegram.server", () => ({
  sendTelegramMessage: (...args: unknown[]) => sendTelegram(...args),
}));

vi.mock("@/env", () => ({
  env: { BETTER_AUTH_URL: "https://app.example.com" },
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

const instances = (routes: string[]) =>
  routes.map((route) => ({ fingerprint: route, labels: { route } }));

// Settings are fetched with .limit(1); silences resolve at .where().
function makeSettingsChain(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  };
}

function makeSilencesChain(rows: unknown[]) {
  return {
    from: () => ({
      where: () => Promise.resolve(rows),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  select.mockReset();
  settingsRows.mockReset();
  silenceRows.mockReset();
  sendTelegram.mockResolvedValue(undefined);
  settingsRows.mockReturnValue([
    {
      delivery: {
        email: { enabled: true, to: ["a@example.com"] },
        telegram: { enabled: true, chatIds: ["123"] },
      },
    },
  ]);
  silenceRows.mockReturnValue([]);
  select.mockImplementationOnce(() => makeSettingsChain(settingsRows()));
  select.mockImplementationOnce(() => makeSilencesChain(silenceRows()));
});

describe("deliverAlertNotification", () => {
  it("sends email and telegram for firing, listing instances", async () => {
    const result = await deliverAlertNotification({
      def,
      kind: "firing",
      summary: "3 bad",
      description: "",
      firingCount: 2,
      instances: instances(["/a", "/b"]),
    });

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@example.com",
        subject: expect.stringContaining("s1"),
        text: expect.stringContaining("Firing instances: 2"),
      }),
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("https://app.example.com/alerts/a1"),
      }),
    );
    expect(sendTelegram).toHaveBeenCalledWith(
      "123",
      expect.stringContaining("route=/a"),
    );
    expect(sendTelegram).toHaveBeenCalledWith(
      "123",
      expect.stringContaining("https://app.example.com/alerts/a1"),
    );
    expect(result).toEqual({
      deliveryTargets: {
        email: ["a@example.com"],
        telegram: ["123"],
      },
      silenceId: "",
    });
  });

  it("suppresses delivery when matchers silence every instance", async () => {
    silenceRows.mockReturnValue([
      { id: "sil-1", matchers: [{ label: "route", op: "=", value: "/a" }] },
    ]);

    const result = await deliverAlertNotification({
      def,
      kind: "firing",
      summary: "x",
      description: "",
      firingCount: 1,
      instances: instances(["/a"]),
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(result).toEqual({ deliveryTargets: {}, silenceId: "sil-1" });
  });

  it("excludes silenced instances but still notifies the rest", async () => {
    silenceRows.mockReturnValue([
      { id: "sil-1", matchers: [{ label: "route", op: "=", value: "/a" }] },
    ]);

    const result = await deliverAlertNotification({
      def,
      kind: "firing",
      summary: "x",
      description: "",
      firingCount: 2,
      instances: instances(["/a", "/b"]),
    });

    expect(sendTelegram).toHaveBeenCalledOnce();
    const text = sendTelegram.mock.calls[0][1] as string;
    expect(text).toContain("route=/b");
    expect(text).not.toContain("route=/a");
    expect(result).toEqual({
      deliveryTargets: {
        email: ["a@example.com"],
        telegram: ["123"],
      },
      silenceId: "",
    });
  });

  it("suppresses everything under a whole-rule silence (no matchers)", async () => {
    silenceRows.mockReturnValue([{ id: "sil-1", matchers: [] }]);

    const result = await deliverAlertNotification({
      def,
      kind: "firing",
      summary: "x",
      description: "",
      firingCount: 2,
      instances: instances(["/a", "/b"]),
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(result).toEqual({ deliveryTargets: {}, silenceId: "sil-1" });
  });

  it("sends resolved delivery without a global toggle", async () => {
    const result = await deliverAlertNotification({
      def,
      kind: "resolved",
      summary: "ok",
      description: "details",
      firingCount: 0,
      instances: instances(["/a"]),
    });

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@example.com",
        subject: "[resolved] s1",
        text: expect.stringContaining("All instances resolved"),
      }),
    );
    const text = sendTelegram.mock.calls[0][1] as string;
    expect(text).not.toContain("[resolved] s1");
    expect(text).not.toContain("ok");
    expect(text).not.toContain("details");
    expect(result).toEqual({
      deliveryTargets: {
        email: ["a@example.com"],
        telegram: ["123"],
      },
      silenceId: "",
    });
  });

  it("sends partial resolved delivery", async () => {
    await deliverAlertNotification({
      def,
      kind: "partial_resolved",
      summary: "1 recovered",
      description: "details",
      firingCount: 2,
      instances: instances(["/a"]),
    });

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@example.com",
        subject: "[partial_resolved] s1",
        text: expect.stringContaining("Resolved instances: 1"),
      }),
    );
    const text = sendTelegram.mock.calls[0][1] as string;
    expect(text).toContain("Still firing instances: 2");
    expect(text).toContain("route=/a");
    expect(text).not.toContain("[partial_resolved] s1");
    expect(text).not.toContain("1 recovered");
    expect(text).not.toContain("details");
    expect(text).not.toContain("All instances resolved");
  });

  it("returns target metadata when a send fails", async () => {
    sendTelegram.mockRejectedValue(new Error("nope"));

    const result = await deliverAlertNotification({
      def,
      kind: "firing",
      summary: "x",
      description: "",
      firingCount: 1,
      instances: instances(["/a"]),
    });

    expect(result).toEqual({
      deliveryTargets: {
        email: ["a@example.com"],
        telegram: ["123"],
      },
      silenceId: "",
    });
  });
});
