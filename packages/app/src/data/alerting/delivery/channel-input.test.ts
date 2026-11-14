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
      ...EMPTY_CHANNEL_DRAFT,
      type: "telegram",
      chatIds: ["-100"],
    });
    expect(channelConfigDraft(SLACK)).toEqual({
      ...EMPTY_CHANNEL_DRAFT,
      type: "slack",
    });
  });
});

describe("readChannelDraft", () => {
  it("requires the secret on a new channel", () => {
    expect(readChannelDraft(EMPTY_CHANNEL_DRAFT, null)).toEqual({
      errors: { url: "URL is required" },
    });
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
      errors: { url: "URL is required" },
    });
  });

  it("needs a bot token and at least one chat for Telegram", () => {
    expect(
      readChannelDraft({ ...EMPTY_CHANNEL_DRAFT, type: "telegram", botToken: "t" }, null),
    ).toEqual({ errors: { chatIds: "Add at least one chat ID" } });
    expect(
      readChannelDraft({ ...EMPTY_CHANNEL_DRAFT, type: "telegram", chatIds: ["-100"] }, null),
    ).toEqual({ errors: { botToken: "Bot token is required" } });
  });

  it("does not turn the read-side marker into a write", () => {
    expect(readChannelDraft({ ...EMPTY_CHANNEL_DRAFT, url: "***" }, null)).toEqual({
      errors: { url: "the redacted channel secret cannot be written" },
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
      errors: { "headers[0].value": "Header value is required for Authorization" },
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
      errors: { "headers[0].value": "Header value is required for X-Token" },
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
      errors: {
        "headers[0].name": "Header Authorization is already set",
        "headers[1].name": "Header authorization is already set",
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
      errors: { "headers[0].value": "header value must contain only latin-1 characters" },
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
      errors: { "headers[0].name": "header Content-Type cannot be set" },
    });
  });
});

describe("an issue channel draft", () => {
  const ISSUES = {
    type: "github_issues" as const,
    repo: "acme/api",
    labels: ["everr-fix"],
    assignees: ["octocat"],
    max_open: 3,
  };

  it("round-trips a saved channel through the editor", () => {
    expect(readChannelDraft(channelConfigDraft(ISSUES), "github_issues")).toEqual({
      config: ISSUES,
    });
  });

  it("leaves the repository out when the field is blank", () => {
    expect(
      readChannelDraft({ ...EMPTY_CHANNEL_DRAFT, type: "github_issues", repo: "  " }, null),
    ).toEqual({
      config: { type: "github_issues", labels: ["everr-fix"], assignees: [], max_open: 5 },
    });
  });

  it("points at the field that blocks the save", () => {
    const draft = { ...channelConfigDraft(ISSUES) };
    expect(readChannelDraft({ ...draft, repo: "not a repo" }, "github_issues")).toEqual({
      errors: { repo: "repository must be owner/name" },
    });
    expect(readChannelDraft({ ...draft, maxOpen: "2.5" }, "github_issues")).toEqual({
      errors: { maxOpen: "Enter a whole number" },
    });
    expect("errors" in readChannelDraft({ ...draft, maxOpen: "0" }, "github_issues")).toBe(true);
  });
});

describe("a Linear channel draft", () => {
  const LINEAR = {
    type: "linear" as const,
    api_key: "***",
    team: "ENG",
    labels: ["everr-fix"],
    assignee: "Fix Agent",
    max_open: 3,
  };

  it("keeps the stored API key when the field is left blank on an edit", () => {
    expect(readChannelDraft(channelConfigDraft(LINEAR), "linear")).toEqual({
      config: {
        type: "linear",
        team: "ENG",
        labels: ["everr-fix"],
        assignee: "Fix Agent",
        max_open: 3,
      },
    });
  });

  it("requires a key and a team on a new channel", () => {
    expect(readChannelDraft({ ...EMPTY_CHANNEL_DRAFT, type: "linear" }, null)).toEqual({
      errors: { apiKey: "API key is required", team: "Team key is required" },
    });
  });

  it("reads the team key in any case", () => {
    expect(
      readChannelDraft({ ...EMPTY_CHANNEL_DRAFT, type: "linear", apiKey: "k", team: "eng" }, null),
    ).toEqual({
      config: { type: "linear", api_key: "k", team: "ENG", labels: ["everr-fix"], max_open: 5 },
    });
  });
});
