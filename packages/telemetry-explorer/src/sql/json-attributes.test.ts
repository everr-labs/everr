import { describe, expect, it } from "vitest";
import {
  attributeExists,
  attributeKeysColumn,
  attributeText,
  flattenAttributes,
  jsonPath,
} from "./json-attributes";

describe("jsonPath", () => {
  it("renders the key as a quoted identifier after the column", () => {
    expect(jsonPath("LogAttributes", "http.route")).toBe(
      "LogAttributes.`http.route`",
    );
  });

  it("escapes backticks and backslashes inside the key", () => {
    expect(jsonPath("LogAttributes", "a`b")).toBe("LogAttributes.`a\\`b`");
    expect(jsonPath("LogAttributes", "a\\b")).toBe("LogAttributes.`a\\\\b`");
  });

  it("leaves quotes, spaces and dots as they are", () => {
    expect(jsonPath("SpanAttributes", "it's a key")).toBe(
      "SpanAttributes.`it's a key`",
    );
  });
});

describe("attributeText", () => {
  it("wraps the path in toString so comparisons are string equality", () => {
    expect(attributeText("LogAttributes", "status")).toBe(
      "toString(LogAttributes.`status`)",
    );
  });
});

describe("attributeKeysColumn and attributeExists", () => {
  it("names the keys column next to the attribute column", () => {
    expect(attributeKeysColumn("LogAttributes")).toBe("LogAttributesKeys");
  });

  it("tests presence on the keys column with an escaped literal", () => {
    expect(attributeExists("LogAttributes", "http.route")).toBe(
      "has(LogAttributesKeys, 'http.route')",
    );
    expect(attributeExists("LogAttributes", "it's")).toBe(
      "has(LogAttributesKeys, 'it\\'s')",
    );
  });
});

describe("flattenAttributes", () => {
  it("joins nested objects with dots and stringifies every leaf", () => {
    expect(
      flattenAttributes({
        http: { route: "/x", response: { status_code: 500 } },
        ok: true,
      }),
    ).toEqual({
      "http.route": "/x",
      "http.response.status_code": "500",
      ok: "true",
    });
  });

  it("returns an empty map for null, undefined, arrays and scalars", () => {
    expect(flattenAttributes(null)).toEqual({});
    expect(flattenAttributes(undefined)).toEqual({});
    expect(flattenAttributes(["a"])).toEqual({});
    expect(flattenAttributes("x")).toEqual({});
  });

  it("keeps array leaves as JSON text and skips null leaves", () => {
    expect(flattenAttributes({ tags: ["a", "b"], gone: null })).toEqual({
      tags: '["a","b"]',
    });
  });

  it("passes a flat map through unchanged", () => {
    expect(flattenAttributes({ "service.name": "api" })).toEqual({
      "service.name": "api",
    });
  });
});
