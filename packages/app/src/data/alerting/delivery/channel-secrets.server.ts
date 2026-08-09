import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { AlertingChannelConfigSchema } from "@/data/alerting/schema";
import type { AlertingChannelConfig } from "@/data/alerting/types";
import { authEnv } from "@/env/auth";

const VERSION = "v1";
const REDACTED = "***";

function key(): Buffer {
  return createHash("sha256")
    .update("everr-alert-channel-v1\0", "utf8")
    .update(authEnv.BETTER_AUTH_SECRET, "utf8")
    .digest();
}

function aad(organizationId: string, channelId: string): Buffer {
  return Buffer.from(`${organizationId}\0${channelId}`, "utf8");
}

export function encryptChannelConfig(
  organizationId: string,
  channelId: string,
  config: AlertingChannelConfig,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(aad(organizationId, channelId));
  const ciphertext = Buffer.concat([
    cipher.update(
      JSON.stringify(AlertingChannelConfigSchema.parse(config)),
      "utf8",
    ),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) =>
      typeof part === "string" ? part : part.toString("base64url"),
    )
    .join(":");
}

export function decryptChannelConfig(
  organizationId: string,
  channelId: string,
  encrypted: string,
): AlertingChannelConfig {
  const [version, ivRaw, tagRaw, ciphertextRaw, ...rest] = encrypted.split(":");
  if (
    version !== VERSION ||
    !ivRaw ||
    !tagRaw ||
    !ciphertextRaw ||
    rest.length > 0
  ) {
    throw new Error("unsupported alert channel secret envelope");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAAD(aad(organizationId, channelId));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return AlertingChannelConfigSchema.parse(JSON.parse(plaintext));
}

export function redactChannelConfig(
  config: AlertingChannelConfig,
): AlertingChannelConfig {
  switch (config.type) {
    case "email":
      return config;
    case "telegram":
      return { ...config, bot_token: REDACTED };
    case "discord":
    case "slack":
    case "webhook":
      return { ...config, url: REDACTED };
  }
}

export function retainRedactedChannelSecrets(
  next: AlertingChannelConfig,
  previous: AlertingChannelConfig,
): AlertingChannelConfig {
  if (next.type !== previous.type) return next;
  switch (next.type) {
    case "email":
      return next;
    case "telegram":
      return {
        ...next,
        bot_token:
          next.bot_token === REDACTED
            ? previous.type === "telegram"
              ? previous.bot_token
              : next.bot_token
            : next.bot_token,
      };
    case "discord":
    case "slack":
    case "webhook":
      return {
        ...next,
        url:
          next.url === REDACTED && previous.type === next.type
            ? previous.url
            : next.url,
      };
  }
}
