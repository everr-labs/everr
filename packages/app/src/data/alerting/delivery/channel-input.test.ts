import { describe, expect, it } from "vite-plus/test";
import {
  channelConfigDraft,
  channelConfigInput,
  channelDraftError,
  EMPTY_CHANNEL_DRAFT,
} from "./channel-input";

const SLACK = { type: "slack" as const, url: "***" };
const TELEGRAM = {
  type: "telegram" as const,
  bot_token: "***",
  chat_ids: ["-100"],
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
    expect(channelConfigInput(channelConfigDraft(SLACK), "slack")).toEqual({
      type: "slack",
    });
    expect(channelConfigInput(channelConfigDraft(TELEGRAM), "telegram")).toEqual({
      type: "telegram",
      chat_ids: ["-100"],
    });
  });

  it("replaces the stored secret with what was typed", () => {
    expect(channelConfigInput({ ...channelConfigDraft(SLACK), url: "https://y" }, "slack")).toEqual(
      { type: "slack", url: "https://y" },
    );
  });

  it("has nothing to keep once the kind changes", () => {
    expect(
      channelConfigInput({ ...channelConfigDraft(SLACK), type: "webhook" }, "slack"),
    ).toBeNull();
  });

  it("needs at least one chat for Telegram", () => {
    expect(
      channelConfigInput({ ...EMPTY_CHANNEL_DRAFT, type: "telegram", botToken: "t" }, null),
    ).toBeNull();
  });

  it("does not turn the read-side marker into a write", () => {
    expect(channelConfigInput({ ...EMPTY_CHANNEL_DRAFT, url: "***" }, null)).toBeNull();
  });
});

const WEBHOOK = {
  type: "webhook" as const,
  url: "***",
  headers: [{ name: "Authorization", value: "***" }],
};

describe("webhook headers on a draft", () => {
  it("keeps stored header names and never the values", () => {
    expect(channelConfigDraft(WEBHOOK)).toEqual({
      ...EMPTY_CHANNEL_DRAFT,
      type: "webhook",
      headers: [{ name: "Authorization", value: "", retainedName: "Authorization" }],
    });
    expect(channelConfigInput(channelConfigDraft(WEBHOOK), "webhook")).toEqual({
      type: "webhook",
      headers: [{ name: "Authorization" }],
    });
  });

  it("sends a typed value and drops a header the reader removed", () => {
    const draft = channelConfigDraft(WEBHOOK);
    draft.headers[0] = { ...draft.headers[0], value: "Bearer next" };
    expect(channelConfigInput(draft, "webhook")).toEqual({
      type: "webhook",
      headers: [{ name: "Authorization", value: "Bearer next" }],
    });
    expect(channelConfigInput({ ...draft, headers: [] }, "webhook")).toEqual({
      type: "webhook",
      headers: [],
    });
  });

  it("requires a value once the stored name is changed", () => {
    const draft = channelConfigDraft(WEBHOOK);
    draft.headers[0] = { ...draft.headers[0], name: "X-Token" };
    expect(channelConfigInput(draft, "webhook")).toBeNull();
    expect(channelDraftError(draft, "webhook")).toBe("Header value is required for X-Token");
  });

  it("ignores an unused blank row and rejects a duplicate name", () => {
    const draft = {
      ...channelConfigDraft(WEBHOOK),
      headers: [
        ...channelConfigDraft(WEBHOOK).headers,
        { name: "", value: "", retainedName: null },
      ],
    };
    expect(channelConfigInput(draft, "webhook")).toEqual({
      type: "webhook",
      headers: [{ name: "Authorization" }],
    });
    draft.headers[1] = {
      name: "authorization",
      value: "second",
      retainedName: null,
    };
    expect(channelConfigInput(draft, "webhook")).toBeNull();
    expect(channelDraftError(draft, "webhook")).toMatch(/already set/);
  });

  it("rejects a header the send is not allowed to set", () => {
    const draft = {
      ...EMPTY_CHANNEL_DRAFT,
      type: "webhook" as const,
      url: "https://x",
      headers: [{ name: "Content-Type", value: "text/plain", retainedName: null }],
    };
    expect(channelConfigInput(draft, null)).toBeNull();
    expect(channelDraftError(draft, null)).toMatch(/cannot be set/);
  });
});
