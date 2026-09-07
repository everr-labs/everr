// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/env/auth", () => ({
  authEnv: { BETTER_AUTH_SECRET: "a-test-secret-long-enough-to-hash" },
}));

import {
  decryptChannelConfig,
  encryptChannelConfig,
  readRedactedChannelConfig,
} from "./channel-secrets.server";

const ORG = "org_test";
const ID = "3b1a7f2e-0c4d-4e8a-9f11-5a6b7c8d9e0f";
const TELEGRAM = {
  type: "telegram" as const,
  bot_token: "123:secret",
  chat_ids: ["-100", "-200"],
};

describe("the channel secret envelope", () => {
  it("round-trips the config through the key", () => {
    const sealed = encryptChannelConfig(ORG, ID, TELEGRAM);
    expect(sealed.split(":")).toHaveLength(4);
    expect(decryptChannelConfig(ORG, ID, sealed)).toEqual(TELEGRAM);
  });

  it("reads the redacted copy without the secret in it", () => {
    const sealed = encryptChannelConfig(ORG, ID, TELEGRAM);
    expect(readRedactedChannelConfig(sealed)).toEqual({
      type: "telegram",
      bot_token: "***",
      chat_ids: ["-100", "-200"],
    });
    expect(sealed).not.toContain("123:secret");
    expect(sealed).not.toContain(
      Buffer.from("123:secret").toString("base64url"),
    );
  });

  it("refuses a public part that was edited under the ciphertext", () => {
    const sealed = encryptChannelConfig(ORG, ID, {
      type: "slack",
      url: "https://hooks.slack.com/x",
    });
    const parts = sealed.split(":");
    parts[3] = Buffer.from(
      JSON.stringify({ type: "webhook", url: "***" }),
    ).toString("base64url");
    const forged = parts.join(":");
    // The forged copy reads as a webhook to a screen, and that is what a
    // send would then refuse: the cipher's additional data no longer matches.
    expect(readRedactedChannelConfig(forged).type).toBe("webhook");
    expect(() => decryptChannelConfig(ORG, ID, forged)).toThrow();
  });

  it("is bound to the organization and the channel", () => {
    const sealed = encryptChannelConfig(ORG, ID, TELEGRAM);
    expect(() => decryptChannelConfig("org_other", ID, sealed)).toThrow();
    expect(() => decryptChannelConfig(ORG, "channel_other", sealed)).toThrow();
  });

  it("reads the redacted copy without decrypting", () => {
    const parts = encryptChannelConfig(ORG, ID, TELEGRAM).split(":");
    parts[2] = Buffer.from("invalid ciphertext").toString("base64url");
    const sealed = parts.join(":");
    expect(readRedactedChannelConfig(sealed).type).toBe("telegram");
    expect(() => decryptChannelConfig(ORG, ID, sealed)).toThrow();
  });

  it.each([
    "",
    "a:b:c",
    "a:b:c:d:e",
    ":b:c:d",
    "a::c:d",
    "a:b::d",
    "a:b:c:",
  ])("refuses a malformed envelope: %s", (sealed) => {
    expect(() => decryptChannelConfig(ORG, ID, sealed)).toThrow(/unsupported/);
    expect(() => readRedactedChannelConfig(sealed)).toThrow(/unsupported/);
  });

  it("validates the public config", () => {
    const parts = encryptChannelConfig(ORG, ID, TELEGRAM).split(":");
    parts[3] = Buffer.from(JSON.stringify({ type: "unknown" })).toString(
      "base64url",
    );
    expect(() => readRedactedChannelConfig(parts.join(":"))).toThrow();
  });
});
