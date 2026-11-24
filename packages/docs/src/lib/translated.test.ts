import { describe, expect, it } from "vite-plus/test";
import { isTranslatedPath } from "./translated";

describe("translated paths", () => {
  it("covers the translated pages, the blog index and each blog post", () => {
    expect(["/pricing", "/blog", "/blog/tracing"].map(isTranslatedPath)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("leaves the docs and nested or look-alike paths out", () => {
    expect(["/docs", "/devlog", "/blog/", "/blog/a/b", "/blogger"].map(isTranslatedPath)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
