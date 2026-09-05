// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/env/auth", () => ({
  authEnv: { BETTER_AUTH_SECRET: "a-test-secret-long-enough-to-hash" },
}));

import { ALERTING_REDACTED_SECRET as REDACTED } from "@/data/alerting/schema";
import type { AlertingChannelConfig } from "@/data/alerting/types";
import {
  decryptChannelConfig,
  encryptChannelConfig,
  readRedactedChannelConfig,
} from "./channel-secrets.server";

/**
 * The encryption module's own contract: a sendable config round-trips with
 * the key, while its read-side representation exposes only public fields.
 * Save semantics are tested through the repository that owns them.
 */

const ORG = "org_test";
const ID = "3b1a7f2e-0c4d-4e8a-9f11-5a6b7c8d9e0f";

const URL_KINDS = ["webhook", "slack", "discord"] as const;
type UrlKind = (typeof URL_KINDS)[number];

/** Long and realistic, so "the envelope does not contain this" cannot pass
 *  by a short string happening to fall inside a base64 blob. */
const hexArb = fc
  .uint8Array({ minLength: 8, maxLength: 16 })
  .map((bytes) => Buffer.from(bytes).toString("hex"));
const urlArb = hexArb.map((path) => `https://203.0.113.10/${path}`);
const botTokenArb = hexArb.map((half) => `123456:${half}`);
const chatIdsArb = fc.array(
  fc.integer({ min: 1, max: 999999 }).map((n) => `-100${n}`),
  { minLength: 1, maxLength: 3 },
);

const urlConfigArb = fc
  .record({ type: fc.constantFrom<UrlKind>(...URL_KINDS), url: urlArb })
  .map((config): AlertingChannelConfig => config);
const telegramConfigArb = fc
  .record({ bot_token: botTokenArb, chat_ids: chatIdsArb })
  .map((config): AlertingChannelConfig => ({ type: "telegram", ...config }));

/** A stored channel of any kind the app can send through. */
const configArb = fc.oneof(urlConfigArb, telegramConfigArb);

/** The secret of a config, whichever field holds it for that kind. */
function secretOf(config: AlertingChannelConfig): string {
  return config.type === "telegram" ? config.bot_token : config.url;
}

describe("a channel config's encrypted envelope", () => {
  it("round-trips the sendable config", () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const sealed = encryptChannelConfig(ORG, ID, config);
        expect(decryptChannelConfig(ORG, ID, sealed)).toEqual(config);
      }),
    );
  });

  it("puts the secret nowhere a reader without the key can see it", () => {
    fc.assert(
      fc.property(configArb, (stored) => {
        const sealed = encryptChannelConfig(ORG, ID, stored);
        const secret = secretOf(stored);
        expect(sealed).not.toContain(secret);
        expect(sealed).not.toContain(
          Buffer.from(secret, "utf8").toString("base64url"),
        );
        expect(secretOf(readRedactedChannelConfig(sealed))).toBe(REDACTED);
      }),
    );
  });

  it("keeps everything but the secret legible without the key", () => {
    fc.assert(
      fc.property(configArb, (stored) => {
        const sealed = encryptChannelConfig(ORG, ID, stored);
        const redacted = readRedactedChannelConfig(sealed);
        expect(redacted.type).toBe(stored.type);
        if (redacted.type === "telegram" && stored.type === "telegram") {
          expect(redacted.chat_ids).toEqual(stored.chat_ids);
        }
      }),
    );
  });
});
