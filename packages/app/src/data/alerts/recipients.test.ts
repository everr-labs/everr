import { describe, expect, it } from "vitest";
import {
  validateSlackWebhookUrl,
  validateTelegramBotToken,
  validateTelegramChatId,
} from "./recipients";

describe("validateTelegramChatId", () => {
  it("accepts numeric IDs, including negative group IDs", () => {
    expect(validateTelegramChatId("123456")).toBeNull();
    expect(validateTelegramChatId("-1001234567890")).toBeNull();
  });

  it("accepts @usernames", () => {
    expect(validateTelegramChatId("@my_team")).toBeNull();
    expect(validateTelegramChatId("@Channel123")).toBeNull();
  });

  it("rejects everything else", () => {
    expect(validateTelegramChatId("abc")).toContain("abc");
    expect(validateTelegramChatId("@ab")).not.toBeNull();
    expect(validateTelegramChatId("12 34")).not.toBeNull();
    expect(validateTelegramChatId("")).not.toBeNull();
  });
});

describe("validateTelegramBotToken", () => {
  it("accepts non-empty tokens", () => {
    expect(validateTelegramBotToken("token")).toBeNull();
  });

  it("rejects blank tokens", () => {
    expect(validateTelegramBotToken("")).toBe("Telegram bot token is required");
    expect(validateTelegramBotToken("   ")).toBe(
      "Telegram bot token is required",
    );
  });
});

describe("validateSlackWebhookUrl", () => {
  it("accepts well-formed Slack webhook URLs", () => {
    expect(
      validateSlackWebhookUrl(
        "https://hooks.slack.com/services/T00000000/B11111111/abcdEFGH0123456789abcdEF",
      ),
    ).toBeNull();
  });

  it("rejects non-Slack or malformed URLs", () => {
    expect(
      validateSlackWebhookUrl("https://example.com/webhook"),
    ).not.toBeNull();
    expect(
      validateSlackWebhookUrl("http://hooks.slack.com/services/T/B/x"),
    ).not.toBeNull();
    expect(validateSlackWebhookUrl("")).not.toBeNull();
  });
});
