import { describe, expect, it } from "vitest";
import {
  channelConfigDraft,
  channelConfigInput,
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
    expect(
      channelConfigInput({ ...EMPTY_CHANNEL_DRAFT, url: "https://x" }, null),
    ).toEqual({ type: "slack", url: "https://x" });
  });

  it("keeps the stored secret when the field is left blank on an edit", () => {
    expect(channelConfigInput(channelConfigDraft(SLACK), "slack")).toEqual({
      type: "slack",
    });
    expect(
      channelConfigInput(channelConfigDraft(TELEGRAM), "telegram"),
    ).toEqual({ type: "telegram", chat_ids: ["-100"] });
  });

  it("replaces the stored secret with what was typed", () => {
    expect(
      channelConfigInput(
        { ...channelConfigDraft(SLACK), url: "https://y" },
        "slack",
      ),
    ).toEqual({ type: "slack", url: "https://y" });
  });

  it("has nothing to keep once the kind changes", () => {
    expect(
      channelConfigInput(
        { ...channelConfigDraft(SLACK), type: "webhook" },
        "slack",
      ),
    ).toBeNull();
  });

  it("needs at least one chat for Telegram", () => {
    expect(
      channelConfigInput(
        { ...EMPTY_CHANNEL_DRAFT, type: "telegram", botToken: "t" },
        null,
      ),
    ).toBeNull();
  });

  it("does not turn the read-side marker into a write", () => {
    expect(
      channelConfigInput({ ...EMPTY_CHANNEL_DRAFT, url: "***" }, null),
    ).toBeNull();
  });
});
