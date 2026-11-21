import { describe, expect, it } from "vite-plus/test";
import { shellRouteOptions } from "./route";

describe("shell time range", () => {
  const { beforeLoad } = shellRouteOptions();

  it("swaps two dates given in the wrong order", () => {
    let redirected: unknown;
    try {
      beforeLoad({ search: { from: "2026-01-02T00:00:00Z", to: "2026-01-01T00:00:00Z" } });
    } catch (error) {
      redirected = error;
    }
    expect(redirected).toMatchObject({
      options: { search: { from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" } },
    });
  });

  it("keeps a relative range that ends before it starts", () => {
    expect(() => beforeLoad({ search: { from: "now", to: "now-1h" } })).not.toThrow();
  });
});
