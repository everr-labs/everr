import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const sendTelegram = vi.fn();
vi.mock("@/lib/telegram.server", () => ({
  sendTelegramMessage: (...args: unknown[]) => sendTelegram(...args),
}));

const sendSlack = vi.fn();
vi.mock("@/lib/slack.server", () => ({
  sendSlackMessage: (...args: unknown[]) => sendSlack(...args),
}));

const addWorkerJob = vi.fn();
vi.mock("@/server/worker/jobs", () => ({
  addWorkerJob: (...args: unknown[]) => addWorkerJob(...args),
}));

const recordEvents = vi.fn();
vi.mock("./03-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./03-events")>();
  return {
    ...actual,
    recordAlertEvents: (...args: unknown[]) => recordEvents(...args),
  };
});

vi.mock("@/env", () => ({
  env: { BETTER_AUTH_URL: "https://app.example.com" },
}));

vi.mock("@/telemetry/logger", () => ({
  exceptionAttributes: (error: unknown) => ({
    "exception.message": error instanceof Error ? error.message : String(error),
  }),
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  serverLogger: { error: vi.fn(), warn: vi.fn() },
}));

import { serverLogger } from "@/telemetry/logger";
import {
  type DeliverySend,
  enqueueAlertNotification,
  type ResolvedDeliveryContext,
  runDeliverySend,
} from "./04-delivery";

const def = {
  id: "a1",
  organizationId: "org-1",
  repoid: "r1",
  slug: "s1",
  preview: "",
  notificationTitleTemplate: "3 bad",
  notificationDescriptionTemplate: "",
};

// The parsed def (without template fields) as it appears in delivery jobs
const sendDef = {
  id: "a1",
  organizationId: "org-1",
  repoid: "r1",
  slug: "s1",
  preview: "",
};
const scheduledFor = new Date("2026-06-12T12:00:00Z");

const defaultContext: ResolvedDeliveryContext = {
  settings: {
    delivery: {
      telegram: {
        enabled: true,
        entries: [{ id: "e1", botToken: "bot-token", chatId: "123" }],
      },
      slack: {
        enabled: true,
        webhooks: [{ id: "w1", url: "https://hooks.slack.com/services/T/B/x" }],
      },
    },
  },
  silences: [],
};

const telegramOnlyContext: ResolvedDeliveryContext = {
  settings: {
    delivery: {
      telegram: {
        enabled: true,
        entries: [{ id: "e1", botToken: "bot-token", chatId: "123" }],
      },
    },
  },
  silences: [],
};

function queuedSends(): DeliverySend[] {
  return addWorkerJob.mock.calls.map((call) => call[1] as DeliverySend);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-12T12:00:00Z"));
  addWorkerJob.mockResolvedValue(undefined);
  sendTelegram.mockResolvedValue(undefined);
  sendSlack.mockResolvedValue(undefined);
  recordEvents.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("enqueueAlertNotification", () => {
  it("enqueues one retryable job per channel target", async () => {
    const result = await enqueueAlertNotification(
      { def, instances: [{ labels: { route: "/a" }, kind: "firing" }] },
      scheduledFor,
      defaultContext,
    );

    expect(addWorkerJob).toHaveBeenCalledTimes(2);
    const sends = queuedSends();
    const telegram = sends.find((s) => s.channel === "telegram");
    const slack = sends.find((s) => s.channel === "slack");

    expect(telegram).toMatchObject({ target: "123", botToken: "bot-token" });
    expect(telegram?.channel === "telegram" && telegram.text).toContain("🔥 s1 firing");
    expect(slack).toMatchObject({
      target: "w1",
      webhookUrl: "https://hooks.slack.com/services/T/B/x",
    });

    expect(result).toEqual({
      deliveryTargets: { telegram: ["123"], slack: ["w1"] },
      perKind: { firing: { silenceId: "" } },
    });
  });

  it("repeats the title per instance for multiple firing instances", async () => {
    const result = await enqueueAlertNotification(
      {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional template placeholder
        def: { ...def, notificationTitleTemplate: "${route} is lagging" },
        instances: [
          {
            labels: { route: "/a" },
            row: { route: "/a", error_rate: 5.1 },
            kind: "firing",
          },
          {
            labels: { route: "/b" },
            row: { route: "/b", error_rate: 6.3 },
            kind: "firing",
          },
        ],
      },
      scheduledFor,
      telegramOnlyContext,
    );

    expect(addWorkerJob).toHaveBeenCalledTimes(1);
    const telegram = queuedSends()[0] as Extract<DeliverySend, { channel: "telegram" }>;
    expect(telegram.text).toBe(
      [
        "🔥 s1 firing",
        "",
        "• /a is lagging",
        "  route=/a — error_rate: 5.1",
        "• /b is lagging",
        "  route=/b — error_rate: 6.3",
        "",
        "2026-06-12 12:00 UTC",
        "Alert: https://app.example.com/alerts/a1",
      ].join("\n"),
    );
    expect(result).toEqual({
      deliveryTargets: { telegram: ["123"] },
      perKind: { firing: { silenceId: "" } },
    });
  });

  it("suppresses delivery when all instances are silenced", async () => {
    const silencedContext: ResolvedDeliveryContext = {
      ...telegramOnlyContext,
      silences: [{ id: "sil-1", matchers: [{ label: "route", op: "=", value: "/a" }] }],
    };

    const result = await enqueueAlertNotification(
      {
        def,
        instances: [{ labels: { route: "/a" }, kind: "firing" }],
      },
      scheduledFor,
      silencedContext,
    );

    expect(addWorkerJob).not.toHaveBeenCalled();
    expect(result).toEqual({
      deliveryTargets: {},
      perKind: { firing: { silenceId: "sil-1" } },
    });
  });

  it("filters out silenced instances and notifies with remaining", async () => {
    const silencedContext: ResolvedDeliveryContext = {
      ...telegramOnlyContext,
      silences: [{ id: "sil-1", matchers: [{ label: "route", op: "=", value: "/a" }] }],
    };

    const result = await enqueueAlertNotification(
      {
        def,
        instances: [
          { labels: { route: "/a" }, kind: "firing" },
          { labels: { route: "/b" }, kind: "firing" },
        ],
      },
      scheduledFor,
      silencedContext,
    );

    expect(addWorkerJob).toHaveBeenCalledTimes(1);
    const telegram = queuedSends().find((send) => send.channel === "telegram");
    expect(telegram?.text).toContain("route=/b");
    expect(telegram?.text).not.toContain("route=/a");
    expect(result).toEqual({
      deliveryTargets: { telegram: ["123"] },
      perKind: { firing: { silenceId: "" } },
    });
  });

  it("suppresses everything under a whole-rule silence (no matchers)", async () => {
    const silencedContext: ResolvedDeliveryContext = {
      ...telegramOnlyContext,
      silences: [{ id: "sil-1", matchers: [] }],
    };

    const result = await enqueueAlertNotification(
      {
        def,
        instances: [{ labels: { route: "/a" }, kind: "firing" }],
      },
      scheduledFor,
      silencedContext,
    );

    expect(addWorkerJob).not.toHaveBeenCalled();
    expect(result).toEqual({
      deliveryTargets: {},
      perKind: { firing: { silenceId: "sil-1" } },
    });
  });

  it("records the first silence id when a kind is fully suppressed by different rules", async () => {
    const silencedContext: ResolvedDeliveryContext = {
      ...telegramOnlyContext,
      silences: [
        { id: "sil-1", matchers: [{ label: "route", op: "=", value: "/a" }] },
        { id: "sil-2", matchers: [{ label: "route", op: "=", value: "/b" }] },
      ],
    };

    const result = await enqueueAlertNotification(
      {
        def,
        instances: [
          { labels: { route: "/a" }, kind: "firing" },
          { labels: { route: "/b" }, kind: "firing" },
        ],
      },
      scheduledFor,
      silencedContext,
    );

    expect(addWorkerJob).not.toHaveBeenCalled();
    expect(result).toEqual({
      deliveryTargets: {},
      perKind: { firing: { silenceId: "sil-1" } },
    });
  });

  it("renders resolved notifications with firing durations", async () => {
    await enqueueAlertNotification(
      {
        def,
        instances: [
          {
            labels: { route: "/a" },
            firedAt: new Date("2026-06-12T11:18:00Z"),
            kind: "resolved",
          },
        ],
      },
      scheduledFor,
      telegramOnlyContext,
    );

    const sends = queuedSends();
    const telegram = sends[0] as Extract<DeliverySend, { channel: "telegram" }>;
    expect(telegram.text).toBe(
      [
        "✅ s1 resolved",
        "",
        "Instance resolved (fired for 42m)",
        "• route=/a — fired for 42m",
        "",
        "2026-06-12 12:00 UTC",
        "Alert: https://app.example.com/alerts/a1",
      ].join("\n"),
    );
  });

  it("renders mixed notifications with firing and resolved sections", async () => {
    await enqueueAlertNotification(
      {
        def,
        instances: [
          { labels: { route: "/a" }, row: { error_rate: 5.1 }, kind: "firing" },
          {
            labels: { route: "/b" },
            firedAt: new Date("2026-06-12T11:18:00Z"),
            kind: "resolved",
          },
        ],
      },
      scheduledFor,
      telegramOnlyContext,
    );

    const sends = queuedSends();
    const telegram = sends[0] as Extract<DeliverySend, { channel: "telegram" }>;
    expect(telegram.text).toBe(
      [
        "🔥 s1 firing + resolved",
        "",
        "Firing:",
        "• 3 bad",
        "  route=/a — error_rate: 5.1",
        "",
        "Resolved:",
        "• route=/b — fired for 42m",
        "",
        "2026-06-12 12:00 UTC",
        "Alert: https://app.example.com/alerts/a1",
      ].join("\n"),
    );
  });

  it("drops a fully-silenced kind from a mixed notification but delivers the rest", async () => {
    const silencedContext: ResolvedDeliveryContext = {
      ...telegramOnlyContext,
      silences: [{ id: "sil-1", matchers: [{ label: "route", op: "=", value: "/a" }] }],
    };

    const result = await enqueueAlertNotification(
      {
        def,
        instances: [
          { labels: { route: "/a" }, row: { error_rate: 5.1 }, kind: "firing" },
          {
            labels: { route: "/b" },
            firedAt: new Date("2026-06-12T11:18:00Z"),
            kind: "resolved",
          },
        ],
      },
      scheduledFor,
      silencedContext,
    );

    expect(addWorkerJob).toHaveBeenCalledTimes(1);
    const telegram = queuedSends()[0] as Extract<DeliverySend, { channel: "telegram" }>;
    expect(telegram.text).toBe(
      [
        "✅ s1 resolved",
        "",
        "Instance resolved (fired for 42m)",
        "• route=/b — fired for 42m",
        "",
        "2026-06-12 12:00 UTC",
        "Alert: https://app.example.com/alerts/a1",
      ].join("\n"),
    );
    expect(result).toEqual({
      deliveryTargets: { telegram: ["123"] },
      perKind: { firing: { silenceId: "sil-1" }, resolved: { silenceId: "" } },
    });
  });
  it("returns null when settings are null", async () => {
    const result = await enqueueAlertNotification(
      {
        def,
        instances: [{ labels: { route: "/a" }, kind: "firing" }],
      },
      scheduledFor,
      { settings: null, silences: [] },
    );

    expect(result).toBeNull();
    expect(addWorkerJob).not.toHaveBeenCalled();
  });
});

function telegramSend(): DeliverySend {
  return {
    channel: "telegram",
    target: "123",
    botToken: "bot-token",
    text: "text",
    def: sendDef,
    scheduledFor,
  };
}

function slackSend(): DeliverySend {
  return {
    channel: "slack",
    target: "w1",
    webhookUrl: "https://hooks.slack.com/services/T/B/x",
    message: { attachments: [{ color: "#dc2626", blocks: [] }] },
    def: sendDef,
    scheduledFor,
  };
}

describe("runDeliverySend", () => {
  it("sends one telegram message", async () => {
    await runDeliverySend(telegramSend(), { attempts: 1, max_attempts: 5 });

    expect(sendTelegram).toHaveBeenCalledWith("bot-token", "123", "text");
  });

  it("sends one slack message", async () => {
    await runDeliverySend(slackSend(), { attempts: 1, max_attempts: 5 });
    expect(sendSlack).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/T/B/x",
      expect.objectContaining({ attachments: expect.any(Array) }),
    );
  });

  it("rethrows on failure so the job retries, without recording an event", async () => {
    sendTelegram.mockRejectedValue(new Error("nope"));

    await expect(runDeliverySend(telegramSend(), { attempts: 1, max_attempts: 5 })).rejects.toThrow(
      "nope",
    );

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
    sendTelegram.mockRejectedValue(new Error("chat deleted"));

    await expect(runDeliverySend(telegramSend(), { attempts: 5, max_attempts: 5 })).rejects.toThrow(
      "chat deleted",
    );

    expect(recordEvents).toHaveBeenCalledWith(
      sendDef,
      [
        expect.objectContaining({
          event_type: "delivery_failed",
          alert_definition_id: "a1",
          delivery_targets: { telegram: ["123"] },
          evidence_json: '{"error":"chat deleted"}',
        }),
      ],
      "alerts.delivery.failure_event_insert_failed",
    );
    expect(vi.mocked(serverLogger.warn)).toHaveBeenCalledWith(
      "alerts.delivery.telegram_failed",
      expect.objectContaining({ "error.handled": true }),
    );
  });

  it("records a slack delivery_failed event on the final attempt", async () => {
    sendSlack.mockRejectedValue(new Error("invalid_payload"));
    await expect(runDeliverySend(slackSend(), { attempts: 5, max_attempts: 5 })).rejects.toThrow();
    expect(recordEvents).toHaveBeenCalledWith(
      sendDef,
      [expect.objectContaining({ delivery_targets: { slack: ["w1"] } })],
      "alerts.delivery.failure_event_insert_failed",
    );
  });
});
