import { describe, expect, it } from "vitest";
import { validateEmailRecipient, validateTelegramChatId } from "./recipients";

describe("validateEmailRecipient", () => {
  it("accepts valid addresses", () => {
    expect(validateEmailRecipient("team@example.com")).toBeNull();
    expect(validateEmailRecipient("a.b+c@sub.example.co")).toBeNull();
  });

  it("rejects malformed addresses with a message naming the value", () => {
    expect(validateEmailRecipient("foo@")).toBe("Invalid email: foo@");
    expect(validateEmailRecipient("foo@bar")).toContain("foo@bar");
    expect(validateEmailRecipient("foo bar@example.com")).not.toBeNull();
  });
});

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
