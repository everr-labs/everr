import { describe, expect, it } from "vitest";
import { deriveOrgName } from "./auto-org";

describe("deriveOrgName", () => {
  it("uses the first name from user name", () => {
    expect(deriveOrgName("Jane Doe", "jane@example.com")).toBe(
      "Jane's workspace",
    );
  });

  it("falls back to email local part when name is empty", () => {
    expect(deriveOrgName("", "bob@example.com")).toBe("bob's workspace");
  });

  it("falls back to email local part when name is whitespace", () => {
    expect(deriveOrgName("  ", "bob@example.com")).toBe("bob's workspace");
  });
});
