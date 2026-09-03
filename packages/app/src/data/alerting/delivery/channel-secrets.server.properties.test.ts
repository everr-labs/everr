// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/env/auth", () => ({
  authEnv: { BETTER_AUTH_SECRET: "a-test-secret-long-enough-to-hash" },
}));

import { ALERTING_REDACTED_SECRET as REDACTED } from "@/data/alerting/schema";
import type { AlertingChannelConfig } from "@/data/alerting/types";
import {
  type ChannelConfigDraft,
  channelConfigDraft,
  channelConfigInput,
} from "./channel-input";
import {
  decryptChannelConfig,
  encryptChannelConfig,
  readRedactedChannelConfig,
  retainRedactedChannelSecrets,
} from "./channel-secrets.server";

/**
 * The seam a channel's secret crosses on every save: the editor never holds
 * the stored secret, so a blank field has to mean "keep it", and the marker
 * that says so travels as if it were the secret itself. Both halves are
 * example-tested on their own side. Nothing tested them composed, and the
 * failure they can only produce together is silent: a save that wipes a
 * working endpoint's credential, or one that stores `***` as the URL and
 * fails at the next send. These generate the pair and check the round trip
 * a save actually performs.
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

/** A draft carrying a typed secret of the draft's own kind. */
function withTyped(draft: ChannelConfigDraft, secret: string) {
  return draft.type === "telegram"
    ? { ...draft, botToken: secret }
    : { ...draft, url: secret };
}

/** The write path a save runs: what the editor sends, what the server keeps
 *  of the stored config, and what lands in the column. Every draft handed to
 *  it here is one the editor would let through; a draft that is not is the
 *  subject of its own property below. */
function save(stored: AlertingChannelConfig | null, draft: ChannelConfigDraft) {
  const input = channelConfigInput(draft, stored);
  if (input === null) throw new Error("the editor would not send this draft");
  const kept = stored ? retainRedactedChannelSecrets(input, stored) : input;
  return { kept, sealed: encryptChannelConfig(ORG, ID, kept) };
}

describe("a channel's secret across the editor and the envelope", () => {
  it("keeps the stored secret through a save that types nothing", () => {
    fc.assert(
      fc.property(configArb, (stored) => {
        const { sealed } = save(stored, channelConfigDraft(stored));
        expect(decryptChannelConfig(ORG, ID, sealed)).toEqual(stored);
      }),
    );
  });

  it("replaces the stored secret with the one that was typed", () => {
    fc.assert(
      fc.property(configArb, urlArb, botTokenArb, (stored, url, botToken) => {
        const typed = stored.type === "telegram" ? botToken : url;
        const { kept, sealed } = save(
          stored,
          withTyped(channelConfigDraft(stored), typed),
        );
        expect(secretOf(kept)).toBe(typed);
        expect(secretOf(decryptChannelConfig(ORG, ID, sealed))).toBe(typed);
      }),
    );
  });

  it("never stores the marker as if it were the secret", () => {
    fc.assert(
      fc.property(
        configArb,
        fc.option(urlArb, { nil: undefined }),
        (stored, typed) => {
          const draft = typed
            ? withTyped(channelConfigDraft(stored), typed)
            : channelConfigDraft(stored);
          const { kept, sealed } = save(stored, draft);
          expect(secretOf(kept)).not.toBe(REDACTED);
          expect(secretOf(decryptChannelConfig(ORG, ID, sealed))).not.toBe(
            REDACTED,
          );
        },
      ),
    );
  });

  it("puts the secret nowhere a reader without the key can see it", () => {
    fc.assert(
      fc.property(configArb, (stored) => {
        const { sealed } = save(stored, channelConfigDraft(stored));
        const secret = secretOf(stored);
        expect(sealed).not.toContain(secret);
        expect(sealed).not.toContain(
          Buffer.from(secret, "utf8").toString("base64url"),
        );
        expect(secretOf(readRedactedChannelConfig(ORG, ID, sealed))).toBe(
          REDACTED,
        );
      }),
    );
  });

  it("keeps everything but the secret legible without the key", () => {
    fc.assert(
      fc.property(configArb, (stored) => {
        const { sealed } = save(stored, channelConfigDraft(stored));
        const redacted = readRedactedChannelConfig(ORG, ID, sealed);
        expect(redacted.type).toBe(stored.type);
        if (redacted.type === "telegram" && stored.type === "telegram") {
          expect(redacted.chat_ids).toEqual(stored.chat_ids);
        }
      }),
    );
  });

  it("carries no secret across a change of kind", () => {
    fc.assert(
      fc.property(configArb, fc.constantFrom(...URL_KINDS), (stored, kind) => {
        fc.pre(kind !== stored.type);
        const draft = { ...channelConfigDraft(stored), type: kind };
        // Nothing typed and nothing to keep: the save cannot be made.
        expect(channelConfigInput(draft, stored)).toBeNull();
        const { kept, sealed } = save(
          stored,
          withTyped(draft, "https://203.0.113.10/n"),
        );
        expect(secretOf(kept)).toBe("https://203.0.113.10/n");
        expect(sealed).not.toContain(secretOf(stored));
      }),
    );
  });
});
