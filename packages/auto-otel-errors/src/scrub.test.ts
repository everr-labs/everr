import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCRUB_PATTERNS,
  filterKeyValueData,
  scrubAttributes,
  scrubString,
} from "./scrub.js";

describe("scrubString", () => {
  it("filters bearer tokens", () => {
    expect(scrubString("auth: Bearer abc.def-123", DEFAULT_SCRUB_PATTERNS)).toBe(
      "auth: [Filtered]",
    );
  });

  it("filters sensitive query params but keeps the param name", () => {
    expect(
      scrubString("GET /cb?token=s3cret&page=2", DEFAULT_SCRUB_PATTERNS),
    ).toBe("GET /cb?token=[Filtered]&page=2");
  });

  it("does not use lookbehind in default patterns", () => {
    expect(DEFAULT_SCRUB_PATTERNS.map((pattern) => pattern.source)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\(\?<[=!]/)]),
    );
  });

  it("filters card-shaped numbers and emails", () => {
    expect(
      scrubString("card 4242 4242 4242 4242 for a@b.com", DEFAULT_SCRUB_PATTERNS),
    ).toBe("card [Filtered] for [Filtered]");
  });

  it("applies custom patterns", () => {
    expect(scrubString("ssn 123-45-6789", [/\d{3}-\d{2}-\d{4}/g])).toBe(
      "ssn [Filtered]",
    );
  });
});

describe("scrubAttributes", () => {
  it("scrubs string values and leaves other types alone", () => {
    const result = scrubAttributes(
      { url: "/cb?password=hunter2", count: 3, ok: true },
      DEFAULT_SCRUB_PATTERNS,
    );
    expect(result).toEqual({
      url: "/cb",
      count: 3,
      ok: true,
    });
  });

  it("strips query and fragment from url.full before applying redaction", () => {
    const result = scrubAttributes(
      {
        "url.full": "https://example.com/cb?token=s3cret&page=2#section",
        other: "/cb?token=s3cret&page=2#section",
      },
      DEFAULT_SCRUB_PATTERNS,
    );
    expect(result).toEqual({
      "url.full": "https://example.com/cb",
      other: "/cb?token=[Filtered]&page=2#section",
    });
  });

  it("strips query from url keys", () => {
    const result = scrubAttributes(
      {
        url: "https://example.com/path?secret=abc",
        "request.url": "https://example.com/path?secret=abc",
      },
      DEFAULT_SCRUB_PATTERNS,
    );
    expect(result).toEqual({
      url: "https://example.com/path",
      "request.url": "https://example.com/path",
    });
  });
});

describe("filterKeyValueData", () => {
  it("filters sensitive keys with default denylist", () => {
    const result = filterKeyValueData(
      {
        authorization: "Bearer token123",
        "x-auth-token": "token456",
        "content-type": "application/json",
        password: "secret",
        "x-api-key": "key123",
        apiKey: "key456",
      },
      true,
    );
    expect(result).toEqual({
      authorization: "[Filtered]",
      "x-auth-token": "[Filtered]",
      "content-type": "application/json",
      password: "[Filtered]",
      "x-api-key": "[Filtered]",
      apiKey: "[Filtered]",
    });
  });

  it("does not filter ordinary words containing short sensitive snippets", () => {
    const result = filterKeyValueData(
      {
        monkey: "banana",
        keyboard: "ansi",
        author: "Ada",
        authority: "docs",
      },
      true,
    );
    expect(result).toEqual({
      monkey: "banana",
      keyboard: "ansi",
      author: "Ada",
      authority: "docs",
    });
  });

  it("leaves keys unfiltered when behavior is false", () => {
    const result = filterKeyValueData(
      { authorization: "Bearer token123" },
      false,
    );
    expect(result).toEqual({ authorization: "Bearer token123" });
  });

  it("filters with custom deny terms", () => {
    const result = filterKeyValueData(
      {
        "x-custom-header": "value",
        authorization: "Bearer token",
      },
      { deny: ["custom"] },
    );
    expect(result).toEqual({
      "x-custom-header": "[Filtered]",
      authorization: "[Filtered]",
    });
  });

  it("filters with allow list", () => {
    const result = filterKeyValueData(
      {
        "content-type": "application/json",
        authorization: "Bearer token",
        "x-request-id": "123",
      },
      { allow: ["content-type"] },
    );
    expect(result).toEqual({
      "content-type": "application/json",
      authorization: "[Filtered]",
      "x-request-id": "[Filtered]",
    });
  });

  it("always filters sensitive keys even in allow list", () => {
    const result = filterKeyValueData(
      {
        authorization: "Bearer token",
        password: "secret",
      },
      { allow: ["authorization", "password"] },
    );
    expect(result).toEqual({
      authorization: "[Filtered]",
      password: "[Filtered]",
    });
  });
});
