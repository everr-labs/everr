import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { CHANNEL_TEXT_MAX } from "#app/data/alerting/delivery/channel-text-limits.ts";

import { ChannelSendError, sendChannelNotification } from "./channel-sender.server";

// A public IP so validateOutboundUrl passes without a DNS lookup.
const HOOK_URL = "https://8.8.8.8/hook";

const oversized = {
  title: "Everr alert: 300 firing",
  body: "x".repeat(10_000),
  url: "https://app.example.com/alerts/default/high-5xx",
};

const fetchMock = vi.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("", { status: 200 }),
);

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sentDiscordContent(): string {
  const body = fetchMock.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") throw new TypeError("Expected a text request body");
  return (JSON.parse(body) as { content: string }).content;
}

it("fits discord's limit by cutting the body, never the url", async () => {
  await sendChannelNotification({ type: "discord", url: HOOK_URL }, oversized);

  const content = sentDiscordContent();
  expect(content.length).toBeLessThanOrEqual(CHANNEL_TEXT_MAX.discord);
  expect(content.startsWith(oversized.title)).toBe(true);
  expect(content.endsWith(`\n\n${oversized.url}`)).toBe(true);
});

it("fits slack's section limit the same way", async () => {
  await sendChannelNotification({ type: "slack", url: HOOK_URL }, oversized);

  const body = fetchMock.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") throw new TypeError("Expected a text request body");
  const message = JSON.parse(body) as {
    attachments: { blocks: { text: { text: string } }[] }[];
  };
  const text = message.attachments[0].blocks[0].text.text;
  expect(text.length).toBeLessThanOrEqual(CHANNEL_TEXT_MAX.slack);
  expect(text.endsWith(`\n\n${oversized.url}`)).toBe(true);
});

type SlackMessage = { attachments: { color: string }[] };

function sentSlackMessage(): SlackMessage {
  const body = fetchMock.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") throw new TypeError("Expected a text request body");
  return JSON.parse(body) as SlackMessage;
}

it.each([
  ["firing", "#dc2626"],
  ["resolved", "#16a34a"],
  [undefined, "#64748b"],
] as const)("colors a %s slack message %s", async (status, color) => {
  await sendChannelNotification(
    { type: "slack", url: HOOK_URL },
    { title: "t", body: "b", status },
  );

  expect(sentSlackMessage().attachments[0].color).toBe(color);
});

it("leaves an in-limit message untouched", async () => {
  const small = { title: "Everr alert: 1 firing", body: "one line" };
  await sendChannelNotification({ type: "discord", url: HOOK_URL }, small);

  expect(sentDiscordContent()).toBe(`${small.title}\n\n${small.body}`);
});

it("sends webhook headers without letting them replace the json content type", async () => {
  await sendChannelNotification(
    {
      type: "webhook",
      url: HOOK_URL,
      headers: [
        { name: "Authorization", value: "Bearer stored-secret" },
        { name: "X-Env", value: "prod" },
      ],
    },
    { title: "t", body: "b" },
  );

  const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
  expect(headers.get("authorization")).toBe("Bearer stored-secret");
  expect(headers.get("x-env")).toBe("prod");
  expect(headers.get("content-type")).toBe("application/json");
});

it("refuses a webhook header that would rewrite the request, and names no value", async () => {
  const secret = "Bearer do-not-leak";
  const error = await sendChannelNotification(
    {
      type: "webhook",
      url: HOOK_URL,
      headers: [{ name: "Content-Type", value: secret }],
    },
    { title: "t", body: "b" },
  ).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(ChannelSendError);
  expect((error as ChannelSendError).permanent).toBe(true);
  expect((error as Error).message).not.toContain(secret);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("marks a 400 permanent: retrying an identical malformed request cannot help", async () => {
  fetchMock.mockResolvedValueOnce(new Response("bad payload", { status: 400 }));

  const error = await sendChannelNotification(
    { type: "webhook", url: HOOK_URL },
    { title: "t", body: "b" },
  ).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(ChannelSendError);
  expect((error as ChannelSendError).permanent).toBe(true);
});

it("marks a 500 transient: worth retrying", async () => {
  fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));

  const error = await sendChannelNotification(
    { type: "webhook", url: HOOK_URL },
    { title: "t", body: "b" },
  ).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(ChannelSendError);
  expect((error as ChannelSendError).permanent).toBe(false);
});

it.each([408, 429])("keeps %d retryable even though it is a 4xx", async (status) => {
  fetchMock.mockResolvedValueOnce(new Response("", { status }));

  const error = await sendChannelNotification(
    { type: "webhook", url: HOOK_URL },
    { title: "t", body: "b" },
  ).catch((caught: unknown) => caught);

  expect((error as ChannelSendError).permanent).toBe(false);
});

// Every channel feeds the same retry decision in send-delivery.ts, which reads
// `cause instanceof ChannelSendError && cause.permanent`. A channel that
// classifies nothing spends the whole attempt budget on an endpoint that has
// already refused it.
it.each([
  ["slack" as const, 403, true],
  ["slack" as const, 500, false],
  ["discord" as const, 403, true],
  ["discord" as const, 500, false],
  ["webhook" as const, 403, true],
  ["webhook" as const, 500, false],
])("classifies a %s %d failure", async (type, status, permanent) => {
  fetchMock.mockResolvedValueOnce(new Response("", { status }));

  const error = await sendChannelNotification(
    { type, url: HOOK_URL },
    { title: "t", body: "b" },
  ).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(ChannelSendError);
  expect((error as ChannelSendError).permanent).toBe(permanent);
});

const BOT_TOKEN = "8123456789:AAH-secret-bot-token";

const telegram = {
  type: "telegram" as const,
  bot_token: BOT_TOKEN,
  chat_ids: ["1", "2"],
};

it("fails a telegram send permanently when every chat refuses permanently", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response("", { status: 403 }))
    .mockResolvedValueOnce(new Response("", { status: 403 }));

  const error = await sendChannelNotification(telegram, {
    title: "t",
    body: "b",
  }).catch((caught: unknown) => caught);

  expect((error as ChannelSendError).permanent).toBe(true);
});

// The regression Promise.all would cause: the permanent chat rejects first and
// its verdict would end the delivery, so the chat behind a 5xx never gets the
// message a retry would have delivered.
it("keeps a telegram send retryable when one chat could still accept it", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response("", { status: 403 }))
    .mockResolvedValueOnce(new Response("", { status: 500 }));

  const error = await sendChannelNotification(telegram, {
    title: "t",
    body: "b",
  }).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(ChannelSendError);
  expect((error as ChannelSendError).permanent).toBe(false);
});

// The error text is appended to the append-only history row, which cannot be
// rewritten, so an address or a token that reaches it cannot be withdrawn.
it("names no chat id and no bot token in the error it hands the history row", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response("", { status: 403 }))
    .mockResolvedValueOnce(new Response("", { status: 403 }));

  const error = await sendChannelNotification(
    { ...telegram, chat_ids: ["-1001234567890", "-1009876543210"] },
    { title: "t", body: "b" },
  ).catch((caught: unknown) => caught);

  const message = (error as Error).message;
  expect(message).not.toContain("-1001234567890");
  expect(message).not.toContain("-1009876543210");
  expect(message).not.toContain(BOT_TOKEN);
  // It still says how much failed, which is the part an investigator needs.
  expect(message).toContain("2 of 2 chats");
});

// Everything string-valued on the error, including a cause. The stack is
// ours and never holds the request. A secret that survives in any other
// field is what the trail and the job log would keep.
function failureText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts = [error.message];
  if (error.cause !== undefined) parts.push(failureText(error.cause));
  const record = error as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === "stack" || key === "message") continue;
    const value = record[key];
    if (typeof value === "string") parts.push(value);
  }
  return parts.join("\n");
}

// The endpoint under a channel URL is not ours. Its answer can repeat a
// header or the URL, and both can be secrets, so a failure keeps neither.
it("leaves the endpoint's answer and the request URL out of a failure", async () => {
  const url = "https://8.8.8.8/hook/super-secret-path";
  const authorization = 'Bearer shared-"secret"';
  fetchMock.mockImplementationOnce(async (_input, init) => {
    const headers = new Headers(init?.headers);
    return new Response(
      JSON.stringify({
        retry: url,
        authorization: headers.get("authorization"),
        env: headers.get("x-env"),
      }),
      { status: 403 },
    );
  });

  const error = (await sendChannelNotification(
    {
      type: "webhook",
      url,
      headers: [
        { name: "Authorization", value: authorization },
        { name: "X-Env", value: "prod" },
      ],
    },
    { title: "t", body: "b" },
  ).catch((caught: unknown) => caught)) as ChannelSendError;

  expect(error).toBeInstanceOf(ChannelSendError);
  expect(error.permanent).toBe(true);
  expect(error.status).toBe(403);
  expect(error.message).toBe("notification webhook failed: 403");
  const text = failureText(error);
  expect(text).not.toContain(url);
  expect(text).not.toContain("super-secret-path");
  expect(text).not.toContain(authorization);
  expect(text).not.toContain("shared-");
  expect(text).not.toContain("prod");
});

// A one-character secret used to be substituted into the redaction marker
// itself, so eleven of them turned a one-character answer into hundreds of
// thousands of characters before the trail truncated it.
it("does not expand a failure when header values are single characters", async () => {
  const secrets = ["a", "e", "d", "c", "t", "r", "s", "-", "[", "]", "o"];
  fetchMock.mockResolvedValueOnce(new Response(secrets[0], { status: 500 }));

  const error = await sendChannelNotification(
    {
      type: "webhook",
      url: HOOK_URL,
      headers: secrets.map((value, index) => ({ name: `X-${index}`, value })),
    },
    { title: "t", body: "b" },
  ).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(ChannelSendError);
  expect((error as Error).message).toBe("notification webhook failed: 500");
  expect(failureText(error).length).toBeLessThan(200);
});

it("does not log the webhook url when the connection fails", async () => {
  const url = "https://8.8.8.8/services/SUPER-SECRET-PATH";
  fetchMock.mockRejectedValueOnce(new TypeError(`fetch failed ${url}`));

  const error = await sendChannelNotification(
    { type: "webhook", url, headers: [{ name: "X-Token", value: "shared-secret" }] },
    { title: "t", body: "b" },
  ).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(ChannelSendError);
  expect((error as ChannelSendError).permanent).toBe(false);
  expect((error as Error).message).toBe("notification webhook failed: network");
  expect(failureText(error)).not.toContain("SUPER-SECRET-PATH");
  expect(failureText(error)).not.toContain("shared-secret");
});

it("names a timeout without the url", async () => {
  const url = "https://8.8.8.8/hook/SUPER-SECRET-PATH";
  const timeout = new Error(`The operation was aborted due to timeout ${url}`);
  timeout.name = "TimeoutError";
  fetchMock.mockRejectedValueOnce(timeout);

  const error = await sendChannelNotification(
    { type: "slack", url },
    { title: "t", body: "b" },
  ).catch((caught: unknown) => caught);

  expect((error as Error).message).toBe("slack webhook failed: timeout");
  expect(failureText(error)).not.toContain("SUPER-SECRET-PATH");
});

it("does not log the bot token when telegram cannot be reached", async () => {
  fetchMock.mockRejectedValueOnce(
    new TypeError(`fetch failed https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`),
  );

  const error = await sendChannelNotification(telegram, { title: "t", body: "b" }).catch(
    (caught: unknown) => caught,
  );

  expect(failureText(error)).not.toContain(BOT_TOKEN);
  expect((error as Error).message).toContain("telegram sendMessage failed: network");
});

it("fails permanently and sends nothing when the bot token is missing", async () => {
  const error = await sendChannelNotification(
    { ...telegram, bot_token: "  " },
    { title: "t", body: "b" },
  ).catch((caught: unknown) => caught);

  expect((error as ChannelSendError).permanent).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
});

// The body is rendered from the rule's annotations against query result
// values, so anything that reaches the monitored system reaches the message.
it("never lets alert text address a discord server", async () => {
  await sendChannelNotification(
    { type: "discord", url: HOOK_URL },
    { title: "Everr alert: 1 firing", body: "@everyone 5xx spike" },
  );

  const body = fetchMock.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") throw new TypeError("Expected a text request body");
  const message = JSON.parse(body) as {
    allowed_mentions: { parse: string[] };
  };
  expect(message.allowed_mentions.parse).toEqual([]);
});

it("never lets alert text become slack markup", async () => {
  await sendChannelNotification(
    { type: "slack", url: HOOK_URL },
    {
      title: "Everr alert: 1 firing",
      body: "<!channel> <https://evil.example|Open the Everr alert> & more",
    },
  );

  const body = fetchMock.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") throw new TypeError("Expected a text request body");
  const message = JSON.parse(body) as {
    attachments: { blocks: { text: { text: string } }[] }[];
  };
  const text = message.attachments[0].blocks[0].text.text;
  expect(text).toContain("&lt;!channel&gt;");
  expect(text).not.toContain("<!channel>");
  expect(text).not.toContain("<https://evil.example|");
});

it("keeps an escaped slack message inside slack's limit", async () => {
  // An entity is five characters where the source was one, so a body of
  // ampersands is the case that overflows if escaping happens after the fit.
  await sendChannelNotification(
    { type: "slack", url: HOOK_URL },
    { title: "Everr alert", body: "&".repeat(CHANNEL_TEXT_MAX.slack) },
  );

  const body = fetchMock.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") throw new TypeError("Expected a text request body");
  const message = JSON.parse(body) as {
    attachments: { blocks: { text: { text: string } }[] }[];
  };
  expect(message.attachments[0].blocks[0].text.text.length).toBeLessThanOrEqual(
    CHANNEL_TEXT_MAX.slack,
  );
});
