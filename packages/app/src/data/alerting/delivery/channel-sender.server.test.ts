import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CHANNEL_TEXT_MAX } from "@/lib/channel-text-limits";

const mocks = vi.hoisted(() => ({ sendSlackMessage: vi.fn() }));

vi.mock("@/lib/slack.server", () => ({
  sendSlackMessage: mocks.sendSlackMessage,
}));

import { sendChannelNotification } from "./channel-sender.server";

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
  mocks.sendSlackMessage.mockReset().mockResolvedValue(undefined);
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

  const message = mocks.sendSlackMessage.mock.calls[0]?.[1] as {
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
