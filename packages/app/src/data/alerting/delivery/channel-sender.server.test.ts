import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CHANNEL_TEXT_MAX } from "@/data/alerting/delivery/channel-text-limits";

import {
  ChannelSendError,
  sendChannelNotification,
} from "./channel-sender.server";

// A public IP so validateOutboundUrl passes without a DNS lookup.
const HOOK_URL = "https://8.8.8.8/hook";

const oversized = {
  title: "Everr alert: 300 firing",
  body: "x".repeat(10_000),
  url: "https://app.everr.dev/alerts/default/high-5xx",
};

const fetchMock = vi.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response("", { status: 200 }),
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
  return (JSON.parse(String(body)) as { content: string }).content;
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
  const message = JSON.parse(String(body)) as {
    attachments: { blocks: { text: { text: string } }[] }[];
  };
  const text = message.attachments[0].blocks[0].text.text;
  expect(text.length).toBeLessThanOrEqual(CHANNEL_TEXT_MAX.slack);
  expect(text.endsWith(`\n\n${oversized.url}`)).toBe(true);
});

it("leaves an in-limit message untouched", async () => {
  const small = { title: "Everr alert: 1 firing", body: "one line" };
  await sendChannelNotification({ type: "discord", url: HOOK_URL }, small);

  expect(sentDiscordContent()).toBe(`${small.title}\n\n${small.body}`);
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

it.each([
  408, 429,
])("keeps %d retryable even though it is a 4xx", async (status) => {
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

it("fails permanently and sends nothing when the bot token is missing", async () => {
  const error = await sendChannelNotification(
    { ...telegram, bot_token: "  " },
    { title: "t", body: "b" },
  ).catch((caught: unknown) => caught);

  expect((error as ChannelSendError).permanent).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
});
