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
    "/everr-app/v0.12.0/everr",
    "/everr-app/v0.12.0/everr-linux-arm64.sha256",
    "/everr-app/v1.0.0-rc.1/release-metadata.json",
    "/everr-app/v1.0.0-rc-1/everr",
  ])("redirects %s to the public artifact base URL", (pathname) => {
    expect(resolveCliReleaseRedirectUrl({ pathname, publicBaseUrl })).toBe(
      `https://cli-release.example.com/releases${pathname}`,
    );
  });

  it.each([
    ["unknown CLI release files", "/everr-app/debug.txt"],
    ["path traversal attempts", "/everr-app/%2E%2E/secret"],
    ["unknown files under a version", "/everr-app/v0.12.0/debug.txt"],
    ["traversal out of a version", "/everr-app/v0.12.0/%2E%2E/everr"],
    ["non-semver versions", "/everr-app/latest/everr"],
    ["versions with build metadata", "/everr-app/v1.0.0+abc/everr"],
    ["malformed encoded paths", "/everr-app/%E0%A4%A"],
  ])("rejects %s", (_, pathname) => {
    expect(resolveCliReleaseRedirectUrl({ pathname, publicBaseUrl })).toBeNull();
  });
});
