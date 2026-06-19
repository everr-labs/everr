import { describe, expect, it } from "vitest";
import {
  DeliverySettingsSchema,
  ensureDeliveryDefaults,
  redactDeliverySecrets,
  resolveDeliverySettings,
  type StoredDeliverySettings,
} from "./delivery-settings";

describe("ensureDeliveryDefaults", () => {
  it("passes through the new entry shape unchanged", () => {
    const stored: StoredDeliverySettings = {
      telegram: {
        enabled: true,
        entries: [{ id: "a", botToken: "b", chatId: "1" }],
      },
      slack: {
        enabled: true,
        webhooks: [{ id: "w", url: "https://hooks.slack.com/services/T/B/x" }],
      },
    };
    expect(ensureDeliveryDefaults(stored)).toEqual(stored);
  });

  it("defaults missing channels", () => {
    expect(ensureDeliveryDefaults(null)).toEqual({
      telegram: { enabled: false, entries: [] },
      slack: { enabled: false, webhooks: [] },
    });
  });

  it("silently strips legacy telegram shape", () => {
    const legacy = {
      telegram: { enabled: true, botToken: "bot", chatIds: ["123", "456"] },
    } as unknown as StoredDeliverySettings;
    const result = ensureDeliveryDefaults(legacy);
    expect(result.telegram).toEqual({ enabled: false, entries: [] });
    expect(result.slack).toEqual({ enabled: false, webhooks: [] });
  });
});

describe("redactDeliverySecrets", () => {
  it("strips bot tokens and webhook urls", () => {
    expect(
      redactDeliverySecrets({
        telegram: {
          enabled: true,
          entries: [{ id: "a", name: "Ops", botToken: "secret", chatId: "1" }],
        },
        slack: {
          enabled: true,
          webhooks: [
            {
              id: "w",
              name: "Eng",
              url: "https://hooks.slack.com/services/T/B/x",
            },
          ],
        },
      }),
    ).toEqual({
      telegram: {
        enabled: true,
        entries: [{ id: "a", name: "Ops", chatId: "1" }],
      },
      slack: { enabled: true, webhooks: [{ id: "w", name: "Eng" }] },
    });
  });
});

describe("DeliverySettingsSchema", () => {
  it("accepts keep-by-id and new entries", () => {
    const parsed = DeliverySettingsSchema.parse({
      telegram: {
        enabled: true,
        entries: [
          { id: "keep-1" },
          { botToken: "t", chatId: "123", name: "Ops" },
        ],
      },
      slack: {
        enabled: true,
        webhooks: [{ url: "https://hooks.slack.com/services/T0/B0/abc123" }],
      },
    });
    expect(parsed.telegram?.entries).toHaveLength(2);
  });

  it("rejects an enabled channel with no entries", () => {
    expect(() =>
      DeliverySettingsSchema.parse({
        telegram: { enabled: true, entries: [] },
      }),
    ).toThrow(/no entries/);
    expect(() =>
      DeliverySettingsSchema.parse({ slack: { enabled: true, webhooks: [] } }),
    ).toThrow(/no webhooks/);
  });

  it("rejects an invalid new webhook url and chat id", () => {
    expect(() =>
      DeliverySettingsSchema.parse({
        slack: { enabled: true, webhooks: [{ url: "nope" }] },
      }),
    ).toThrow();
    expect(() =>
      DeliverySettingsSchema.parse({
        telegram: {
          enabled: true,
          entries: [{ botToken: "t", chatId: "bad id" }],
        },
      }),
    ).toThrow();
  });
});

describe("resolveDeliverySettings", () => {
  const stored: StoredDeliverySettings = {
    telegram: {
      enabled: true,
      entries: [{ id: "keep-1", name: "Ops", botToken: "tok", chatId: "123" }],
    },
    slack: {
      enabled: true,
      webhooks: [
        { id: "w-1", url: "https://hooks.slack.com/services/T/B/old" },
      ],
    },
  };

  it("keeps an existing entry verbatim by id", () => {
    const merged = resolveDeliverySettings(stored, {
      telegram: { enabled: true, entries: [{ id: "keep-1" }] },
    });
    expect(merged.telegram).toEqual({
      enabled: true,
      entries: [stored.telegram?.entries[0]],
    });
  });

  it("adds a new entry with a generated id", () => {
    const merged = resolveDeliverySettings(stored, {
      telegram: {
        enabled: true,
        entries: [{ botToken: "new-tok", chatId: "999", name: "New" }],
      },
    });
    const entry = merged.telegram?.entries[0];
    expect(entry?.id).toMatch(/.+/);
    expect(entry).toMatchObject({
      name: "New",
      botToken: "new-tok",
      chatId: "999",
    });
  });

  it("drops entries whose ids are absent from the input", () => {
    const merged = resolveDeliverySettings(stored, {
      telegram: { enabled: false, entries: [] },
    });
    expect(merged.telegram).toEqual({ enabled: false, entries: [] });
  });

  it("throws when keeping an unknown id", () => {
    expect(() =>
      resolveDeliverySettings(stored, {
        telegram: { enabled: true, entries: [{ id: "ghost" }] },
      }),
    ).toThrow(/Unknown Telegram entry/);
  });
});
