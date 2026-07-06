import { describe, expect, it } from "vitest";
import type { CcReceiver, CcRoute } from "@/data/cc/types";
import {
  DeliverySettingsSchema,
  normalizeDeliverySettings,
  receiversToDeliverySettings,
  remindEverySecondsFromRoutes,
  slackWebhookUrlError,
} from "./delivery-settings";

const receiver = (
  name: string,
  channel: CcReceiver["channel"],
): CcReceiver => ({ id: name, tenant: "t", name, channel });

const route = (over: Partial<CcRoute> = {}): CcRoute => ({
  id: "r",
  tenant: "t",
  matchers: [],
  receiver: "everr-default-email",
  continue: true,
  priority: 1000,
  group_by: null,
  group_wait_secs: null,
  group_interval_secs: null,
  repeat_interval_secs: null,
  ...over,
});

describe("normalizeDeliverySettings", () => {
  it("normalizes legacy Telegram settings without a bot token", () => {
    expect(
      normalizeDeliverySettings({
        telegram: { enabled: true, chatIds: ["123"] },
      } as never),
    ).toEqual({
      email: { enabled: false, to: [] },
      telegram: { enabled: true, botToken: "", chatIds: ["123"] },
      slack: { enabled: false, webhookUrl: "" },
      remindEverySeconds: null,
    });
  });

  it("normalizes and trims the Slack webhook URL", () => {
    const url = "https://hooks.slack.com/services/T00/B00/xyz";
    expect(
      normalizeDeliverySettings({
        slack: { enabled: true, webhookUrl: ` ${url} ` },
      } as never).slack,
    ).toEqual({ enabled: true, webhookUrl: url });
  });
});

describe("receiversToDeliverySettings", () => {
  const url = "https://hooks.slack.com/services/T00/B00/xyz";

  it("maps a managed Slack receiver to an enabled slack section", () => {
    const out = receiversToDeliverySettings([
      receiver("everr-default-slack", { type: "slack", url }),
    ]);
    expect(out.slack).toEqual({ enabled: true, webhookUrl: url });
  });

  it("treats a missing/empty Slack receiver as disabled", () => {
    expect(receiversToDeliverySettings([]).slack).toEqual({
      enabled: false,
      webhookUrl: "",
    });
    const out = receiversToDeliverySettings([
      receiver("everr-default-slack", { type: "slack", url: "" }),
    ]);
    expect(out.slack).toEqual({ enabled: false, webhookUrl: "" });
  });

  it("round-trips a stored Slack URL unchanged (keep-if-unchanged)", () => {
    const settings = receiversToDeliverySettings([
      receiver("everr-default-slack", { type: "slack", url }),
    ]);
    // The form re-submits the value read back from CC; a normalize pass over it
    // preserves the original secret so an unedited save keeps it intact.
    expect(normalizeDeliverySettings(settings).slack.webhookUrl).toBe(url);
  });
});

describe("remindEverySeconds schema", () => {
  it("defaults to null (off) when omitted", () => {
    expect(DeliverySettingsSchema.parse({}).remindEverySeconds).toBeNull();
  });

  it("accepts null and integers at or above 60", () => {
    expect(
      DeliverySettingsSchema.parse({ remindEverySeconds: null })
        .remindEverySeconds,
    ).toBeNull();
    expect(
      DeliverySettingsSchema.parse({ remindEverySeconds: 3600 })
        .remindEverySeconds,
    ).toBe(3600);
  });

  it("rejects values below 60 and non-integers", () => {
    expect(
      DeliverySettingsSchema.safeParse({ remindEverySeconds: 59 }).success,
    ).toBe(false);
    expect(
      DeliverySettingsSchema.safeParse({ remindEverySeconds: 90.5 }).success,
    ).toBe(false);
  });
});

describe("remindEverySecondsFromRoutes", () => {
  it("is null when no managed catch-all route carries an interval", () => {
    expect(remindEverySecondsFromRoutes([])).toBeNull();
    expect(
      remindEverySecondsFromRoutes([
        route({ receiver: "everr-default-email", repeat_interval_secs: null }),
      ]),
    ).toBeNull();
  });

  it("reads the interval from agreeing managed routes", () => {
    expect(
      remindEverySecondsFromRoutes([
        route({ receiver: "everr-default-email", repeat_interval_secs: 3600 }),
        route({
          receiver: "everr-default-telegram",
          repeat_interval_secs: 3600,
        }),
      ]),
    ).toBe(3600);
  });

  it("surfaces the max when managed routes disagree", () => {
    expect(
      remindEverySecondsFromRoutes([
        route({ receiver: "everr-default-email", repeat_interval_secs: 3600 }),
        route({
          receiver: "everr-default-telegram",
          repeat_interval_secs: 14400,
        }),
        route({ receiver: "everr-default-slack", repeat_interval_secs: null }),
      ]),
    ).toBe(14400);
  });

  it("ignores non-managed routes and routes with matchers", () => {
    expect(
      remindEverySecondsFromRoutes([
        route({ receiver: "power-user", repeat_interval_secs: 60 }),
        route({
          receiver: "everr-default-email",
          matchers: [{ label: "x", op: "eq", value: "y" }],
          repeat_interval_secs: 60,
        }),
      ]),
    ).toBeNull();
  });
});

describe("receiversToDeliverySettings remind-every", () => {
  it("derives remindEverySeconds from the passed routes", () => {
    const out = receiversToDeliverySettings(
      [],
      [route({ receiver: "everr-default-email", repeat_interval_secs: 3600 })],
    );
    expect(out.remindEverySeconds).toBe(3600);
  });

  it("defaults to null when routes are omitted", () => {
    expect(receiversToDeliverySettings([]).remindEverySeconds).toBeNull();
  });
});

describe("slackWebhookUrlError", () => {
  const url = "https://hooks.slack.com/services/T00/B00/xyz";

  it("is undefined when disabled regardless of value", () => {
    expect(slackWebhookUrlError(false, "")).toBeUndefined();
    expect(slackWebhookUrlError(false, "nonsense")).toBeUndefined();
  });

  it("flags an enabled channel with an empty or malformed URL", () => {
    expect(slackWebhookUrlError(true, "")).toBeTruthy();
    expect(slackWebhookUrlError(true, "https://example.com")).toBeTruthy();
  });

  it("passes an enabled channel with a valid URL", () => {
    expect(slackWebhookUrlError(true, url)).toBeUndefined();
  });
});
