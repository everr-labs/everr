import { describe, expect, it } from "vite-plus/test";
import { cacheShareImage, shareImageHead } from "./og-cache";

describe("share image caching", () => {
  it("lets caches keep a share image for a day", () => {
    const response = cacheShareImage(
      new Response("png", { headers: { "content-type": "image/png" } }),
    );

    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("answers HEAD with the image headers and no body", async () => {
    const response = shareImageHead();

    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(await response.text()).toBe("");
  });
});
