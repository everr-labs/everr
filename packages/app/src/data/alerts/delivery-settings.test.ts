import { describe, expect, it } from "vitest";
import { normalizeDeliverySettings } from "./delivery-settings";

describe("normalizeDeliverySettings", () => {
  it("normalizes legacy Telegram settings without a bot token", () => {
    expect(
      normalizeDeliverySettings({
        telegram: { enabled: true, chatIds: ["123"] },
      } as never),
    ).toEqual({
      email: { enabled: false, to: [] },
      telegram: { enabled: true, botToken: "", chatIds: ["123"] },
    });
  });
});
