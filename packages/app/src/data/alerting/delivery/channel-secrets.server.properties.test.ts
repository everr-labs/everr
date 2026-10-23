// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("#app/env/auth.ts", () => ({
  authEnv: { BETTER_AUTH_SECRET: "a-test-secret-long-enough-to-hash" },
}));

import { ALERTING_REDACTED_SECRET as REDACTED } from "#app/data/alerting/schema.ts";
import type { AlertingChannelConfig } from "#app/data/alerting/types.ts";
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

const URL_KINDS = ["slack", "discord"] as const;
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
const webhookHeadersArb = fc
  .array(
    fc.record({
      name: hexArb,
      value: hexArb.map((value) => `secret-${value}`),
    }),
    { minLength: 1, maxLength: 3 },
  )
  .map((headers) =>
    headers.map((header, index) => ({
      name: `X-Test-${index}-${header.name}`,
      value: header.value,
    })),
  );
const webhookConfigArb = fc
  .record({
    url: urlArb,
    headers: fc.option(webhookHeadersArb, { nil: undefined }),
  })
  .map((config): AlertingChannelConfig =>
    config.headers
      ? { type: "webhook", url: config.url, headers: config.headers }
      : { type: "webhook", url: config.url },
  );
const telegramConfigArb = fc
  .record({ bot_token: botTokenArb, chat_ids: chatIdsArb })
  .map((config): AlertingChannelConfig => ({ type: "telegram", ...config }));

/** A stored channel of any kind the app can send through. */
const configArb = fc.oneof(urlConfigArb, webhookConfigArb, telegramConfigArb);

/** The fields a reader can see without the key: the kind, Telegram chats,
 *  and webhook header names. Secrets stay out of this shape. */
function legible(config: AlertingChannelConfig) {
  switch (config.type) {
    case "telegram":
      return { type: config.type, chat_ids: config.chat_ids };
    case "webhook":
      return {
        type: config.type,
        headerNames: (config.headers ?? []).map((header) => header.name),
      };
    case "slack":
    case "discord":
      return { type: config.type };
  }
}

/** Every secret a config holds. Header values count: they authenticate the
 *  endpoint the same way the URL does. */
function secretsOf(config: AlertingChannelConfig): string[] {
  switch (config.type) {
    case "telegram":
      return [config.bot_token];
    case "webhook":
      return [config.url, ...(config.headers ?? []).map((header) => header.value)];
    case "slack":
    case "discord":
      return [config.url];
  }
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
        const redacted = readRedactedChannelConfig(sealed);
        for (const secret of secretsOf(stored)) {
          expect(sealed).not.toContain(secret);
          expect(sealed).not.toContain(Buffer.from(secret, "utf8").toString("base64url"));
          expect(secretsOf(redacted)).not.toContain(secret);
        }
        expect(secretsOf(redacted).every((secret) => secret === REDACTED)).toBe(true);
      }),
    );
  });

  it("keeps everything but the secret legible without the key", () => {
    fc.assert(
      fc.property(configArb, (stored) => {
        const sealed = encryptChannelConfig(ORG, ID, stored);
        const redacted = readRedactedChannelConfig(sealed);
        expect(legible(redacted)).toEqual(legible(stored));
      }),
    );
  });
});
