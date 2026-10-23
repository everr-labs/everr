import { describe, expect, it } from "vite-plus/test";
import {
  channelConfigDraft,
  channelConfigInput,
  EMPTY_CHANNEL_DRAFT,
  emptyChannelHeaderDraft,
} from "./channel-input";

const SLACK = { type: "slack" as const, url: "***" };
const TELEGRAM = {
  type: "telegram" as const,
  bot_token: "***",
  chat_ids: ["-100"],
};
const WEBHOOK = {
  type: "webhook" as const,
  url: "***",
  headers: [
    { name: "Authorization", value: "***" },
    { name: "X-API-Key", value: "***" },
  ],
};

describe("channelConfigDraft", () => {
  it("starts an edit from the kind and the chats, never the secret", () => {
    expect(channelConfigDraft(TELEGRAM)).toEqual({
      type: "telegram",
      url: "",
      botToken: "",
      chatIds: ["-100"],
      headers: [],
    });
    expect(channelConfigDraft(SLACK)).toEqual({
      ...EMPTY_CHANNEL_DRAFT,
      type: "slack",
    });
  });

  it("keeps the header names and forgets the redacted values", () => {
    expect(channelConfigDraft(WEBHOOK)).toMatchObject({
      ...EMPTY_CHANNEL_DRAFT,
      type: "webhook",
      headers: [
        { name: "Authorization", value: "" },
        { name: "X-API-Key", value: "" },
      ],
    });
  });
});

describe("channelConfigInput", () => {
  it("is incomplete until the secret is typed on a new channel", () => {
    expect(channelConfigInput(EMPTY_CHANNEL_DRAFT, null)).toBeNull();
    expect(channelConfigInput({ ...EMPTY_CHANNEL_DRAFT, url: "https://x" }, null)).toEqual({
      type: "slack",
      url: "https://x",
    });
  });

  it("keeps the stored secret when the field is left blank on an edit", () => {
    expect(channelConfigInput(channelConfigDraft(SLACK), SLACK)).toEqual({
      type: "slack",
    });
    expect(channelConfigInput(channelConfigDraft(TELEGRAM), TELEGRAM)).toEqual({
      type: "telegram",
      chat_ids: ["-100"],
    });
  });

  it("replaces the stored secret with what was typed", () => {
    expect(channelConfigInput({ ...channelConfigDraft(SLACK), url: "https://y" }, SLACK)).toEqual({
      type: "slack",
      url: "https://y",
    });
  });

  it("has nothing to keep once the kind changes", () => {
    expect(channelConfigInput({ ...channelConfigDraft(SLACK), type: "webhook" }, SLACK)).toBeNull();
  });

  it("needs at least one chat for Telegram", () => {
    expect(
      channelConfigInput({ ...EMPTY_CHANNEL_DRAFT, type: "telegram", botToken: "t" }, null),
    ).toBeNull();
  });

  it("does not turn the read-side marker into a write", () => {
    expect(channelConfigInput({ ...EMPTY_CHANNEL_DRAFT, url: "***" }, null)).toBeNull();
    expect(
      channelConfigInput(
        {
          ...EMPTY_CHANNEL_DRAFT,
          type: "webhook",
          url: "https://x",
          headers: [{ name: "Authorization", value: "***" }],
        },
        null,
      ),
    ).toBeNull();
  });
});

describe("webhook headers", () => {
  it("sends stored names without values so the server keeps them", () => {
    expect(channelConfigInput(channelConfigDraft(WEBHOOK), WEBHOOK)).toEqual({
      type: "webhook",
      headers: [{ name: "Authorization" }, { name: "X-API-Key" }],
    });
  });

  it("replaces one value and adds a header without re-entering the rest", () => {
    const draft = channelConfigDraft(WEBHOOK);
    draft.headers[0].value = "Bearer new";
    draft.headers.push(emptyChannelHeaderDraft("X-Tenant", "acme"));

    expect(channelConfigInput(draft, WEBHOOK)).toEqual({
      type: "webhook",
      headers: [
        { name: "Authorization", value: "Bearer new" },
        { name: "X-API-Key" },
        { name: "X-Tenant", value: "acme" },
      ],
    });
  });

  it("drops a header removed from the draft", () => {
    const draft = channelConfigDraft(WEBHOOK);
    draft.headers = draft.headers.filter((header) => header.name !== "X-API-Key");

    expect(channelConfigInput(draft, WEBHOOK)).toEqual({
      type: "webhook",
      headers: [{ name: "Authorization" }],
    });
  });

  it("sends an empty list when every header is removed", () => {
    const draft = channelConfigDraft(WEBHOOK);
    draft.headers = [];

    expect(channelConfigInput(draft, WEBHOOK)).toEqual({
      type: "webhook",
      headers: [],
    });
  });

  it("is incomplete when a new header has no value", () => {
    const draft = channelConfigDraft(WEBHOOK);
    draft.headers.push(emptyChannelHeaderDraft("X-Tenant"));

    expect(channelConfigInput(draft, WEBHOOK)).toBeNull();
  });

  it("is incomplete when a stored header is renamed without a value", () => {
    const draft = channelConfigDraft(WEBHOOK);
    draft.headers[0].name = "X-API-Token";

    expect(channelConfigInput(draft, WEBHOOK)).toBeNull();
  });

  it("refuses two names that differ only by case", () => {
    const draft = channelConfigDraft(WEBHOOK);
    draft.headers.push(emptyChannelHeaderDraft("authorization", "another"));

    expect(channelConfigInput(draft, WEBHOOK)).toBeNull();
  });
});
