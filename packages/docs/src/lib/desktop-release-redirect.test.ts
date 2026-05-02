import { describe, expect, it } from "vitest";
import { resolveDesktopReleaseRedirectUrl } from "./desktop-release-redirect";

const publicBaseUrl = "https://desktop-release.example.com/releases/";

describe("resolveDesktopReleaseRedirectUrl", () => {
  it("redirects allowed desktop release files to the public artifact base URL", () => {
    expect(
      resolveDesktopReleaseRedirectUrl({
        pathname: "/everr-app/latest.json",
        publicBaseUrl,
      }),
    ).toBe(
      "https://desktop-release.example.com/releases/everr-app/latest.json",
    );
  });

  it("rejects unknown desktop release files", () => {
    expect(
      resolveDesktopReleaseRedirectUrl({
        pathname: "/everr-app/debug.txt",
        publicBaseUrl,
      }),
    ).toBeNull();
  });

  it("rejects path traversal attempts", () => {
    expect(
      resolveDesktopReleaseRedirectUrl({
        pathname: "/everr-app/%2E%2E/secret",
        publicBaseUrl,
      }),
    ).toBeNull();
  });
});
