import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
vi.mock("@/lib/mailer.server", () => ({
  mailer: { send: (...args: unknown[]) => sendEmail(...args) },
}));

const sendTelegram = vi.fn();
vi.mock("@/lib/telegram.server", () => ({
  sendTelegramMessage: (...args: unknown[]) => sendTelegram(...args),
}));

const addWorkerJob = vi.fn();
vi.mock("@/server/worker/jobs", () => ({
  addWorkerJob: (...args: unknown[]) => addWorkerJob(...args),
}));

const recordEvents = vi.fn();
vi.mock("./events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./events")>();
  return {
    ...actual,
    recordAlertEvents: (...args: unknown[]) => recordEvents(...args),
  };
});

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
import {
  type DeliverySend,
  enqueueAlertNotification,
  runDeliverySend,
} from "./delivery";

const def = { id: "a1", organizationId: "org-1", repoid: "r1", slug: "s1" };
const scheduledFor = new Date("2026-06-12T12:00:00Z");

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

function queuedSends(): DeliverySend[] {
  return addWorkerJob.mock.calls.map((call) => call[1] as DeliverySend);
}

function asEmailSend(send: DeliverySend | undefined) {
  if (send?.channel !== "email") throw new Error("expected email send");
  return send;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The message bodies embed the (UTC) delivery time; pin it.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-12T12:00:00Z"));
  select.mockReset();
  settingsRows.mockReset();
  silenceRows.mockReset();
  addWorkerJob.mockResolvedValue(undefined);
  sendEmail.mockResolvedValue(undefined);
  sendTelegram.mockResolvedValue(undefined);
  recordEvents.mockResolvedValue(undefined);
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

describe("enqueueAlertNotification", () => {
  it("enqueues one retryable job per channel target", async () => {
    const result = await enqueueAlertNotification(
      {
        def,
        kind: "firing",
        summary: "3 bad",
        description: "",
        firingCount: 2,
        instances: instances(["/a", "/b"]),
      },
      scheduledFor,
    );

    expect(addWorkerJob).toHaveBeenCalledTimes(2);
    expect(addWorkerJob).toHaveBeenCalledWith(
      "alerts/deliver",
      expect.objectContaining({ channel: "email", target: "a@example.com" }),
      {
        jobKey:
          "alerts/deliver:a1:2026-06-12T12:00:00.000Z:firing:email:a@example.com",
        jobKeyMode: "replace",
        maxAttempts: 5,
      },
    );
    expect(addWorkerJob).toHaveBeenCalledWith(
      "alerts/deliver",
      expect.objectContaining({ channel: "telegram", target: "123" }),
      expect.objectContaining({
        jobKey:
          "alerts/deliver:a1:2026-06-12T12:00:00.000Z:firing:telegram:123",
      }),
    );

    const sends = queuedSends();
    const email = asEmailSend(sends[0]);
    const telegram = sends[1];
    expect(email.subject).toBe("🔥 [firing] s1 — 2 instances");
    expect(email.text).toContain("Firing instances: 2");
    expect(email.text).toContain("2026-06-12 12:00 UTC");
    expect(email.html).toContain("View alert");
    expect(email.html).toContain("https://app.example.com/alerts/a1");
    expect(email.def).toEqual(def);
    expect(telegram.text).toBe(
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

    // Nothing is sent inline anymore.
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendTelegram).not.toHaveBeenCalled();
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

    const result = await enqueueAlertNotification(
      {
        def,
        kind: "firing",
        summary: "x",
        description: "",
        firingCount: 1,
        instances: instances(["/a"]),
      },
      scheduledFor,
    );

    expect(addWorkerJob).not.toHaveBeenCalled();
    expect(result).toEqual({ deliveryTargets: {}, silenceId: "sil-1" });
  });

  it("excludes silenced instances but still notifies the rest", async () => {
    silenceRows.mockReturnValue([
      { id: "sil-1", matchers: [{ label: "route", op: "=", value: "/a" }] },
    ]);

    const result = await enqueueAlertNotification(
      {
        def,
        kind: "firing",
        summary: "x",
        description: "",
        firingCount: 2,
        instances: instances(["/a", "/b"]),
      },
      scheduledFor,
    );

    const telegram = queuedSends().find((send) => send.channel === "telegram");
    expect(telegram?.text).toContain("route=/b");
    expect(telegram?.text).not.toContain("route=/a");
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

    const result = await enqueueAlertNotification(
      {
        def,
        kind: "firing",
        summary: "x",
        description: "",
        firingCount: 2,
        instances: instances(["/a", "/b"]),
      },
      scheduledFor,
    );

    expect(addWorkerJob).not.toHaveBeenCalled();
    expect(result).toEqual({ deliveryTargets: {}, silenceId: "sil-1" });
  });

  it("renders resolved notifications with firing durations", async () => {
    await enqueueAlertNotification(
      {
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
      },
      scheduledFor,
    );

    const sends = queuedSends();
    const email = asEmailSend(sends[0]);
    const telegram = sends[1];
    expect(email.subject).toBe("✅ [resolved] s1");
    expect(email.text).toContain("All instances resolved (fired for 42m)");
    expect(email.text).toContain("- route=/a — fired for 42m");
    expect(telegram.text).toBe(
      [
        "✅ s1 resolved",
        "",
        "All instances resolved",
        "• route=/a — fired for 42m",
        "",
        "2026-06-12 12:00 UTC",
        "https://app.example.com/alerts/a1",
      ].join("\n"),
    );
  });

  it("escapes user content in the email html", async () => {
    await enqueueAlertNotification(
      {
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
      },
      scheduledFor,
    );

    const email = asEmailSend(
      queuedSends().find((send) => send.channel === "email"),
    );
    expect(email.text).toContain(
      "- route=/a<script> — error_rate: 7.2, error_count: 12",
    );
    expect(email.html).not.toContain("/a<script>");
    expect(email.html).toContain("/a&lt;script&gt;");
    expect(email.html).toContain("bad &lt;b&gt;stuff&lt;/b&gt;");
  });
});

function emailSend(): DeliverySend {
  return {
    channel: "email",
    target: "a@example.com",
    subject: "subject",
    text: "text",
    html: "<p>html</p>",
    def,
    scheduledFor,
  };
}

function telegramSend(): DeliverySend {
  return {
    channel: "telegram",
    target: "123",
    text: "text",
    def,
    scheduledFor,
  };
}

describe("runDeliverySend", () => {
  it("sends one email", async () => {
    await runDeliverySend(emailSend(), { attempts: 1, max_attempts: 5 });

    expect(sendEmail).toHaveBeenCalledWith({
      to: "a@example.com",
      subject: "subject",
      text: "text",
      html: "<p>html</p>",
    });
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("sends one telegram message", async () => {
    await runDeliverySend(telegramSend(), { attempts: 1, max_attempts: 5 });

    expect(sendTelegram).toHaveBeenCalledWith("123", "text");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rethrows on failure so the job retries, without recording an event", async () => {
    sendTelegram.mockRejectedValue(new Error("nope"));

    await expect(
      runDeliverySend(telegramSend(), { attempts: 1, max_attempts: 5 }),
    ).rejects.toThrow("nope");

    expect(vi.mocked(serverLogger.warn)).toHaveBeenCalledWith(
      "alerts.delivery.telegram_failed",
      expect.objectContaining({
        "alert.definition_id": "a1",
        "alert.delivery_target": "123",
        "graphile_worker.job.attempts": 1,
        "error.handled": false,
      }),
    );
    expect(recordEvents).not.toHaveBeenCalled();
  });

  it("records a delivery_failed event on the final attempt", async () => {
    sendEmail.mockRejectedValue(new Error("mailbox full"));

    await expect(
      runDeliverySend(emailSend(), { attempts: 5, max_attempts: 5 }),
    ).rejects.toThrow("mailbox full");

    expect(recordEvents).toHaveBeenCalledWith(
      def,
      [
        expect.objectContaining({
          event_type: "delivery_failed",
          alert_definition_id: "a1",
          delivery_targets: { email: ["a@example.com"] },
          evidence_json: '{"error":"mailbox full"}',
        }),
      ],
      "alerts.delivery.failure_event_insert_failed",
    );
    expect(vi.mocked(serverLogger.warn)).toHaveBeenCalledWith(
      "alerts.delivery.email_failed",
      expect.objectContaining({ "error.handled": true }),
    );
  });
});
