/**
 * How a channel's config is kept at rest, and the two ways it is read back:
 * the secret for a send, and the redacted copy for a screen.
 *
 * The envelope is `iv:tag:ciphertext:public`. The last part is the
 * redacted config in the clear, so a list of channels never decrypts a
 * thing; it is also bound into the cipher's additional data, so a public
 * part edited in the database breaks the next decrypt rather than showing a
 * kind the ciphertext does not hold.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  AlertingChannelConfigSchema,
  ALERTING_REDACTED_SECRET as REDACTED,
} from "@/data/alerting/schema";
import type { AlertingChannelConfig } from "@/data/alerting/types";
import { authEnv } from "@/env/auth";

function key(): Buffer {
  return createHash("sha256")
    .update("everr-alert-channel\0", "utf8")
    .update(authEnv.BETTER_AUTH_SECRET, "utf8")
    .digest();
}

function aad(organizationId: string, channelId: string, publicPart: string) {
  return Buffer.from(`${organizationId}\0${channelId}\0${publicPart}`, "utf8");
}

function encodePublic(config: AlertingChannelConfig): string {
  return Buffer.from(
    JSON.stringify(redactChannelConfig(config)),
    "utf8",
  ).toString("base64url");
}

function decodePublic(publicPart: string): AlertingChannelConfig {
  return AlertingChannelConfigSchema.parse(
    JSON.parse(Buffer.from(publicPart, "base64url").toString("utf8")),
  );
}

export function encryptChannelConfig(
  organizationId: string,
  channelId: string,
  config: AlertingChannelConfig,
): string {
  const parsed = AlertingChannelConfigSchema.parse(config);
  const publicPart = encodePublic(parsed);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(aad(organizationId, channelId, publicPart));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(parsed), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
    publicPart,
  ].join(":");
}

type Envelope = {
  iv: string;
  tag: string;
  ciphertext: string;
  publicPart: string;
};

function openEnvelope(encrypted: string): Envelope {
  const [iv, tag, ciphertext, publicPart, ...rest] = encrypted.split(":");
  if (!iv || !tag || !ciphertext || !publicPart || rest.length > 0) {
    throw new Error("unsupported alert channel secret envelope");
  }
  return { iv, tag, ciphertext, publicPart };
}

export function decryptChannelConfig(
  organizationId: string,
  channelId: string,
  encrypted: string,
): AlertingChannelConfig {
  const { iv, tag, ciphertext, publicPart } = openEnvelope(encrypted);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(aad(organizationId, channelId, publicPart));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return AlertingChannelConfigSchema.parse(JSON.parse(plaintext));
}

/**
 * The config with its secret redacted, read without touching the key.
 * A screen listing every channel pays a base64 decode per row rather than
 * a key derivation and a decrypt.
 */
export function readRedactedChannelConfig(
  encrypted: string,
): AlertingChannelConfig {
  return decodePublic(openEnvelope(encrypted).publicPart);
}

function redactChannelConfig(
  config: AlertingChannelConfig,
): AlertingChannelConfig {
  switch (config.type) {
    case "telegram":
      return { ...config, bot_token: REDACTED };
    case "discord":
    case "slack":
    case "webhook":
      return { ...config, url: REDACTED };
  }
}
