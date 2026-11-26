import { describe, expect, it } from "vite-plus/test";
import { trailingSlashRedirect } from "./trailing-slash";

function redirectFor(path: string) {
  const response = trailingSlashRedirect(new URL(`https://everr.dev${path}`));
  return response && { status: response.status, location: response.headers.get("location") };
}

describe("trailing slash redirect", () => {
  it("permanently redirects to the path without the slash, keeping the query", () => {
    expect(redirectFor("/pricing/")).toEqual({ status: 308, location: "/pricing" });
    expect(redirectFor("/blog/?page=2")).toEqual({ status: 308, location: "/blog?page=2" });
    expect(redirectFor("/devlog//")).toEqual({ status: 308, location: "/devlog" });
  });

  it("never redirects to another host", () => {
    for (const path of ["//evil.com/", "/\\evil.com/", "///evil.com//", "/..//evil.com/"]) {
      expect(redirectFor(path)).toEqual({ status: 308, location: "/evil.com" });
    }
    expect(redirectFor("//")).toEqual({ status: 308, location: "/" });
  });

  it("leaves the home page and paths without a trailing slash alone", () => {
    expect(redirectFor("/")).toBeUndefined();
    expect(redirectFor("/pricing")).toBeUndefined();
    expect(redirectFor("/docs/learn/install?q=a/")).toBeUndefined();
  });
});
