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
    expect(decryptChannelConfig(ORG, ID, sealed)).toEqual(TELEGRAM);
  });

  it("reads the redacted copy without the secret in it", () => {
    const sealed = encryptChannelConfig(ORG, ID, TELEGRAM);
    expect(readRedactedChannelConfig(ORG, ID, sealed)).toEqual({
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
    parts[4] = Buffer.from(
      JSON.stringify({ type: "webhook", url: "***" }),
    ).toString("base64url");
    const forged = parts.join(":");
    // The forged copy reads as a webhook to a screen, and that is what a
    // send would then refuse: the cipher's additional data no longer matches.
    expect(readRedactedChannelConfig(ORG, ID, forged).type).toBe("webhook");
    expect(() => decryptChannelConfig(ORG, ID, forged)).toThrow();
  });

  it("is bound to the organization and the channel", () => {
    const sealed = encryptChannelConfig(ORG, ID, TELEGRAM);
    expect(() => decryptChannelConfig("org_other", ID, sealed)).toThrow();
  });

  it("still opens a v1 envelope, decrypting for the redacted copy", () => {
    const sealed = encryptChannelConfig(ORG, ID, TELEGRAM);
    // A v1 envelope is the same cipher over the same plaintext with the
    // public part neither appended nor bound. Re-seal one by hand from the
    // legacy code's shape: the key and the layout are unchanged.
    const legacy = sealV1(TELEGRAM);
    expect(decryptChannelConfig(ORG, ID, legacy)).toEqual(TELEGRAM);
    expect(readRedactedChannelConfig(ORG, ID, legacy)).toEqual(
      readRedactedChannelConfig(ORG, ID, sealed),
    );
  });

  it("refuses an envelope of another shape", () => {
    expect(() => decryptChannelConfig(ORG, ID, "v3:a:b:c:d")).toThrow(
      /unsupported/,
    );
    expect(() => readRedactedChannelConfig(ORG, ID, "v2:a:b:c")).toThrow(
      /unsupported/,
    );
  });
});

/** The pre-public-part envelope, written the way the v1 writer wrote it. */
function sealV1(config: typeof TELEGRAM): string {
  const { createCipheriv, createHash, randomBytes } = require("node:crypto");
  const key = createHash("sha256")
    .update("everr-alert-channel-v1\0", "utf8")
    .update("a-test-secret-long-enough-to-hash", "utf8")
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${ORG}\0${ID}`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(config), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}
