import { describe, expect, it } from "vite-plus/test";
import { resolveCliReleaseRedirectUrl } from "./cli-release-redirect";

const publicBaseUrl = "https://cli-release.example.com/releases/";

describe("resolveCliReleaseRedirectUrl", () => {
  it.each([
    "/everr-app/release-metadata.json",
    "/everr-app/everr",
    "/everr-app/everr.sha256",
    "/everr-app/everr-linux-arm64",
    "/everr-app/everr-linux-x86_64",
    "/everr-app/everr-linux-x86_64.sha256",
  ])("redirects %s to the public artifact base URL", (pathname) => {
    expect(resolveCliReleaseRedirectUrl({ pathname, publicBaseUrl })).toBe(
      `https://cli-release.example.com/releases${pathname}`,
    );
  });

  it.each([
    ["unknown CLI release files", "/everr-app/debug.txt"],
    ["path traversal attempts", "/everr-app/%2E%2E/secret"],
    ["malformed encoded paths", "/everr-app/%E0%A4%A"],
  ])("rejects %s", (_, pathname) => {
    expect(resolveCliReleaseRedirectUrl({ pathname, publicBaseUrl })).toBeNull();
  });
});
