import { describe, expect, it } from "vite-plus/test";
import { channelConfigDraft, EMPTY_CHANNEL_DRAFT, readChannelDraft } from "./channel-input";

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

describe("readChannelDraft", () => {
  it("is incomplete until the secret is typed on a new channel", () => {
    expect(readChannelDraft(EMPTY_CHANNEL_DRAFT, null)).toEqual({ incomplete: true });
    expect(readChannelDraft({ ...EMPTY_CHANNEL_DRAFT, url: "https://x" }, null)).toEqual({
      config: { type: "slack", url: "https://x" },
    });
  });

  it("keeps the stored secret when the field is left blank on an edit", () => {
    expect(readChannelDraft(channelConfigDraft(SLACK), "slack")).toEqual({
      config: { type: "slack" },
    });
    expect(readChannelDraft(channelConfigDraft(TELEGRAM), "telegram")).toEqual({
      config: { type: "telegram", chat_ids: ["-100"] },
    });
  });

  it("replaces the stored secret with what was typed", () => {
    expect(readChannelDraft({ ...channelConfigDraft(SLACK), url: "https://y" }, "slack")).toEqual({
      config: { type: "slack", url: "https://y" },
    });
  });

  it("has nothing to keep once the kind changes", () => {
    expect(readChannelDraft({ ...channelConfigDraft(SLACK), type: "webhook" }, "slack")).toEqual({
      incomplete: true,
    });
  });

  it("needs at least one chat for Telegram", () => {
    expect(
      readChannelDraft({ ...EMPTY_CHANNEL_DRAFT, type: "telegram", botToken: "t" }, null),
    ).toEqual({ incomplete: true });
  });

  it("does not turn the read-side marker into a write", () => {
    expect(readChannelDraft({ ...EMPTY_CHANNEL_DRAFT, url: "***" }, null)).toEqual({
      incomplete: true,
    });
  });
});

const WEBHOOK = {
  type: "webhook" as const,
  url: "***",
  headers: [{ name: "Authorization", value: "***" }],
};

describe("webhook headers on a draft", () => {
  it("keeps stored header names and never the values", () => {
    const draft = channelConfigDraft(WEBHOOK);
    expect(draft).toMatchObject({
      type: "webhook",
      url: "",
      botToken: "",
      chatIds: [],
    });
    expect(draft.headers).toEqual([
      expect.objectContaining({
        name: "Authorization",
        value: "",
        retainedName: "Authorization",
      }),
    ]);
    expect(readChannelDraft(draft, "webhook")).toEqual({
      config: {
        type: "webhook",
        headers: [{ name: "Authorization" }],
      },
    });
  });

  it("sends a typed value and drops a header the reader removed", () => {
    const draft = channelConfigDraft(WEBHOOK);
    draft.headers[0] = { ...draft.headers[0], value: "Bearer next" };
    expect(readChannelDraft(draft, "webhook")).toEqual({
      config: {
        type: "webhook",
        headers: [{ name: "Authorization", value: "Bearer next" }],
      },
    });
    expect(readChannelDraft({ ...draft, headers: [] }, "webhook")).toEqual({
      config: { type: "webhook", headers: [] },
    });
  });

  it("requires header values again when the URL is replaced", () => {
    const draft = { ...channelConfigDraft(WEBHOOK), url: "https://203.0.113.11/hook" };
    expect(readChannelDraft(draft, "webhook")).toEqual({
      error: {
        message: "Header value is required for Authorization",
        rows: [{ name: false, value: true }],
      },
    });
    draft.headers[0] = { ...draft.headers[0], value: "Bearer next" };
    expect(readChannelDraft(draft, "webhook")).toEqual({
      config: {
        type: "webhook",
        url: "https://203.0.113.11/hook",
        headers: [{ name: "Authorization", value: "Bearer next" }],
      },
    });
  });

  it("requires a value once the stored name is changed", () => {
    const draft = channelConfigDraft(WEBHOOK);
    draft.headers[0] = { ...draft.headers[0], name: "X-Token" };
    expect(readChannelDraft(draft, "webhook")).toEqual({
      error: {
        message: "Header value is required for X-Token",
        rows: [{ name: false, value: true }],
      },
    });
  });

  it("ignores an unused blank row and rejects a duplicate name", () => {
    const draft = {
      ...channelConfigDraft(WEBHOOK),
      headers: [
        ...channelConfigDraft(WEBHOOK).headers,
        { id: "blank", name: "", value: "", retainedName: null },
      ],
    };
    expect(readChannelDraft(draft, "webhook")).toEqual({
      config: {
        type: "webhook",
        headers: [{ name: "Authorization" }],
      },
    });
    draft.headers[1] = {
      id: "second",
      name: "authorization",
      value: "second",
      retainedName: null,
    };
    expect(readChannelDraft(draft, "webhook")).toEqual({
      error: {
        message: "Header authorization is already set",
        rows: [
          { name: true, value: false },
          { name: true, value: false },
        ],
      },
    });
  });

  it("rejects a header value the request cannot send", () => {
    const draft = {
      ...EMPTY_CHANNEL_DRAFT,
      type: "webhook" as const,
      url: "https://x",
      headers: [{ id: "latin1", name: "X-Token", value: "token-\u0100", retainedName: null }],
    };
    expect(readChannelDraft(draft, null)).toEqual({
      error: {
        message: "header value must contain only latin-1 characters",
        rows: [{ name: false, value: true }],
      },
    });
  });

  it("rejects a header the send is not allowed to set", () => {
    const draft = {
      ...EMPTY_CHANNEL_DRAFT,
      type: "webhook" as const,
      url: "https://x",
      headers: [{ id: "blocked", name: "Content-Type", value: "text/plain", retainedName: null }],
    };
    expect(readChannelDraft(draft, null)).toEqual({
      error: {
        message: "header Content-Type cannot be set",
        rows: [{ name: true, value: false }],
      },
    });
  });
});
