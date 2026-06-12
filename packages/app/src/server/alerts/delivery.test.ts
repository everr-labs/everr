import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  serverLogger: { error: vi.fn(), warn: vi.fn() },
}));

import { serverLogger } from "@/telemetry/logger";
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
  // The message bodies embed the (UTC) delivery time; pin it.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-12T12:00:00Z"));
  select.mockReset();
  settingsRows.mockReset();
  silenceRows.mockReset();
  sendEmail.mockResolvedValue(undefined);
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

afterEach(() => {
  vi.useRealTimers();
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
        subject: "🔥 [firing] s1 — 2 instances",
        text: expect.stringContaining("Firing instances: 2"),
        html: expect.stringContaining("View alert"),
      }),
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("background:#ff6467;color:#0a0a0a"),
      }),
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("https://app.example.com/alerts/a1"),
        html: expect.stringContaining("https://app.example.com/alerts/a1"),
      }),
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("2026-06-12 12:00 UTC"),
        html: expect.stringContaining("2026-06-12 12:00 UTC"),
      }),
    );
    expect(sendTelegram).toHaveBeenCalledWith(
      "123",
      [
        "🔥 s1 firing",
        "",
        "3 bad",
        "",
        "Firing: 2",
        "• route=/a",
        "• route=/b",
        "",
        "2026-06-12 12:00 UTC",
        "https://app.example.com/alerts/a1",
      ].join("\n"),
    );
    expect(result).toEqual({
      deliveryTargets: {
        email: ["a@example.com"],
        telegram: ["123"],
      },
      silenceId: "",
      failures: [],
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
    expect(result).toEqual({
      deliveryTargets: {},
      silenceId: "sil-1",
      failures: [],
    });
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
      failures: [],
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
    expect(result).toEqual({
      deliveryTargets: {},
      silenceId: "sil-1",
      failures: [],
    });
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
        subject: "✅ [resolved] s1",
        text: expect.stringContaining("All instances resolved"),
      }),
    );
    const text = sendTelegram.mock.calls[0][1] as string;
    expect(text).toBe(
      [
        "✅ s1 resolved",
        "",
        "All instances resolved",
        "• route=/a",
        "",
        "2026-06-12 12:00 UTC",
        "https://app.example.com/alerts/a1",
      ].join("\n"),
    );
    expect(text).not.toContain("[resolved] s1");
    expect(text).not.toContain("ok");
    expect(text).not.toContain("details");
    expect(result).toEqual({
      deliveryTargets: {
        email: ["a@example.com"],
        telegram: ["123"],
      },
      silenceId: "",
      failures: [],
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
        subject: "✅ [partial_resolved] s1",
        text: expect.stringContaining("Resolved instances: 1"),
      }),
    );
    const text = sendTelegram.mock.calls[0][1] as string;
    expect(text).toBe(
      [
        "✅ s1 partially resolved",
        "",
        "Resolved: 1",
        "Still firing: 2",
        "• route=/a",
        "",
        "2026-06-12 12:00 UTC",
        "https://app.example.com/alerts/a1",
      ].join("\n"),
    );
    expect(text).not.toContain("[partial_resolved] s1");
    expect(text).not.toContain("1 recovered");
    expect(text).not.toContain("details");
    expect(text).not.toContain("All instances resolved");
  });

  it("includes instance values for firing and escapes labels in html", async () => {
    await deliverAlertNotification({
      def,
      kind: "firing",
      summary: "bad <b>stuff</b>",
      description: "",
      firingCount: 1,
      instances: [
        {
          labels: { route: "/a<script>" },
          row: { route: "/a<script>", error_rate: 7.2, error_count: "12" },
        },
      ],
    });

    const email = sendEmail.mock.calls[0][0] as {
      text: string;
      html: string;
    };
    expect(email.text).toContain(
      "- route=/a<script> — error_rate: 7.2, error_count: 12",
    );
    expect(email.html).toContain("error_rate: 7.2");
    expect(email.html).not.toContain("/a<script>");
    expect(email.html).toContain("/a&lt;script&gt;");
    expect(email.html).toContain("bad &lt;b&gt;stuff&lt;/b&gt;");
    const telegram = sendTelegram.mock.calls[0][1] as string;
    expect(telegram).toContain(
      "• route=/a<script> — error_rate: 7.2, error_count: 12",
    );
  });

  it("includes firing durations for resolved instances", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00Z"));
    try {
      await deliverAlertNotification({
        def,
        kind: "resolved",
        summary: "ok",
        description: "",
        firingCount: 0,
        instances: [
          {
            labels: { route: "/a" },
            firedAt: new Date("2026-06-12T11:18:00Z"),
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    const email = sendEmail.mock.calls[0][0] as { text: string; html: string };
    expect(email.text).toContain("All instances resolved (fired for 42m)");
    expect(email.text).toContain("- route=/a — fired for 42m");
    expect(email.html).toContain("fired for 42m");
    const telegram = sendTelegram.mock.calls[0][1] as string;
    expect(telegram).toContain("• route=/a — fired for 42m");
  });

  it("returns target metadata and the failure when a send fails", async () => {
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
      failures: [{ channel: "telegram", target: "123", error: "nope" }],
    });
  });

  it("still delivers to remaining targets when one recipient fails", async () => {
    settingsRows.mockReturnValue([
      {
        delivery: {
          email: { enabled: true, to: ["a@example.com", "b@example.com"] },
          telegram: { enabled: true, chatIds: ["bad", "456"] },
        },
      },
    ]);
    select.mockReset();
    select.mockImplementationOnce(() => makeSettingsChain(settingsRows()));
    select.mockImplementationOnce(() => makeSilencesChain(silenceRows()));
    sendEmail.mockRejectedValueOnce(new Error("mailbox full"));
    sendTelegram.mockRejectedValueOnce(new Error("chat not found"));

    await deliverAlertNotification({
      def,
      kind: "firing",
      summary: "x",
      description: "",
      firingCount: 1,
      instances: instances(["/a"]),
    });

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({ to: "b@example.com" }),
    );
    expect(sendTelegram).toHaveBeenCalledTimes(2);
    expect(sendTelegram).toHaveBeenLastCalledWith("456", expect.any(String));
    expect(vi.mocked(serverLogger.warn)).toHaveBeenCalledWith(
      "alerts.delivery.email_failed",
      expect.objectContaining({
        "alert.definition_id": "a1",
        "alert.delivery_target": "a@example.com",
      }),
    );
    expect(vi.mocked(serverLogger.warn)).toHaveBeenCalledWith(
      "alerts.delivery.telegram_failed",
      expect.objectContaining({
        "alert.definition_id": "a1",
        "alert.delivery_target": "bad",
      }),
    );
  });
});
