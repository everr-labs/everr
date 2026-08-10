import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { AlertingChannelConfig } from "@/data/alerting/types";
import { CHANNEL_TEXT_MAX } from "@/lib/channel-text-limits";
import { sendSlackMessage } from "@/lib/slack.server";
import { sendTelegramMessage } from "@/lib/telegram.server";
import { truncateWithEllipsis } from "@/lib/truncate";

const SEND_TIMEOUT_MS = 10_000;

export interface ChannelNotification {
  title: string;
  body: string;
  url?: string;
}

function blockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value)))
    return true;
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function blockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("::ffff:")
  );
}

function blockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedIpv4(address);
  if (family === 6) return blockedIpv6(address);
  return true;
}

async function validateOutboundUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("notification URL must be a valid absolute URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("notification URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("notification URL must not contain userinfo");
  }
  const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("notification URL must not target localhost");
  }
  if (isIP(hostname) && blockedAddress(hostname)) {
    throw new Error("notification URL must not target an internal address");
  }
  if (!isIP(hostname)) {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (
      addresses.length === 0 ||
      addresses.some((item) => blockedAddress(item.address))
    ) {
      throw new Error("notification URL resolved to an internal address");
    }
  }
  return url;
}

async function postJson(urlRaw: string, body: unknown): Promise<void> {
  const url = await validateOutboundUrl(urlRaw);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `notification webhook failed: ${response.status} ${detail}`,
    );
  }
}

// The url is the pointer to the alert page and the highest-value token in
// the message. When a channel limit forces a cut, the body gives way and the
// url survives whole; only a title and url that alone exceed the limit fall
// back to a blind cut.
function composeText(notification: ChannelNotification, max: number): string {
  const url = notification.url ?? "";
  const frameLength = url
    ? notification.title.length + url.length + 4
    : notification.title.length + 2;
  const bodyBudget = max - frameLength;
  if (bodyBudget <= 0) {
    return truncateWithEllipsis(
      [notification.title, url].filter(Boolean).join("\n\n"),
      max,
    );
  }
  return [
    notification.title,
    truncateWithEllipsis(notification.body, bodyBudget),
    url,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function sendChannelNotification(
  config: AlertingChannelConfig,
  notification: ChannelNotification,
): Promise<void> {
  switch (config.type) {
    case "webhook":
      await postJson(config.url, notification);
      return;
    case "slack":
      await validateOutboundUrl(config.url);
      await sendSlackMessage(config.url, {
        attachments: [
          {
            color: "#dc2626",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: composeText(notification, CHANNEL_TEXT_MAX.slack),
                },
              },
            ],
          },
        ],
      });
      return;
    case "discord":
      await postJson(config.url, {
        content: composeText(notification, CHANNEL_TEXT_MAX.discord),
      });
      return;
    case "telegram":
      await Promise.all(
        config.chat_ids.map((chatId) =>
          sendTelegramMessage(
            config.bot_token,
            chatId,
            composeText(notification, CHANNEL_TEXT_MAX.telegram),
          ),
        ),
      );
      return;
    case "email": {
      const { mailer } = await import("@/lib/mailer.server");
      await Promise.all(
        config.to.map((to) =>
          mailer.send({
            to,
            subject: notification.title,
            text: [notification.title, notification.body, notification.url]
              .filter(Boolean)
              .join("\n\n"),
          }),
        ),
      );
    }
  }
}

export function sendChannelTest(config: AlertingChannelConfig): Promise<void> {
  return sendChannelNotification(config, {
    title: "Everr test notification",
    body: "This channel is configured correctly.",
  });
}
