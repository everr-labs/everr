import { describe, expect, it } from "vite-plus/test";
import { blogPageTitle } from "./blog-format";

describe("blog page title", () => {
  it("appends the suffix when the result fits in 60 characters", () => {
    expect(blogPageTitle("Short title", "Everr Blog")).toBe("Short title - Everr Blog");
    const exact = "x".repeat(60 - " - Everr Blog".length);
    expect(blogPageTitle(exact, "Everr Blog")).toHaveLength(60);
  });

  it("keeps the bare title when the suffix would push it past 60", () => {
    const title = "x".repeat(60 - " - Everr Blog".length + 1);
    expect(blogPageTitle(title, "Everr Blog")).toBe(title);
  });
});
