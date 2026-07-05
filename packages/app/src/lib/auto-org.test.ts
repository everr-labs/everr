import { describe, expect, it } from "vite-plus/test";
import { deriveOrgName } from "./auto-org";

describe("deriveOrgName", () => {
  it("uses the first name from user name", () => {
    expect(deriveOrgName("Jane Doe", "jane@example.com")).toBe("Jane's organization");
  });

  it("falls back to email local part when name is empty", () => {
    expect(deriveOrgName("", "bob@example.com")).toBe("bob's organization");
  });

  it("falls back to email local part when name is whitespace", () => {
    expect(deriveOrgName("  ", "bob@example.com")).toBe("bob's organization");
  });
});
