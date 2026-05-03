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

  it("redirects CLI release files to the public artifact base URL", () => {
    expect(
      resolveDesktopReleaseRedirectUrl({
        pathname: "/everr-app/everr",
        publicBaseUrl,
      }),
    ).toBe("https://desktop-release.example.com/releases/everr-app/everr");

    expect(
      resolveDesktopReleaseRedirectUrl({
        pathname: "/everr-app/everr.sha256",
        publicBaseUrl,
      }),
    ).toBe(
      "https://desktop-release.example.com/releases/everr-app/everr.sha256",
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

  it("rejects malformed encoded paths", () => {
    expect(
      resolveDesktopReleaseRedirectUrl({
        pathname: "/everr-app/%E0%A4%A",
        publicBaseUrl,
      }),
    ).toBeNull();
  });
});
