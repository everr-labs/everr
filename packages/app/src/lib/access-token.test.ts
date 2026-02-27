import { describe, expect, it } from "vitest";
import {
  generateAccessToken,
  getAccessTokenPrefix,
  hashAccessToken,
  obfuscateAccessTokenPrefix,
} from "./access-token";

describe("access-token", () => {
  it("generates tokens with the eacc_ prefix", () => {
    const token = generateAccessToken();

    expect(token.startsWith("eacc_")).toBe(true);
    expect(token.length).toBeGreaterThan("eacc_".length);
  });

  it("hashes tokens deterministically", () => {
    const first = hashAccessToken("eacc_example");
    const second = hashAccessToken("eacc_example");

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("extracts and obfuscates token prefixes", () => {
    const tokenPrefix = getAccessTokenPrefix("eacc_1234567890abcdef");

    expect(tokenPrefix).toBe("eacc_1234567890a");
    expect(obfuscateAccessTokenPrefix(tokenPrefix)).toBe(
      "eacc_1234567890a********",
    );
  });
});
