import { describe, expect, it } from "vitest";
import { resolveCliReleaseRedirectUrl } from "./cli-release-redirect";

const publicBaseUrl = "https://cli-release.example.com/releases/";

describe("resolveCliReleaseRedirectUrl", () => {
  it("redirects allowed CLI release files to the public artifact base URL", () => {
    expect(
      resolveCliReleaseRedirectUrl({
        pathname: "/everr-app/release-metadata.json",
        publicBaseUrl,
      }),
    ).toBe(
      "https://cli-release.example.com/releases/everr-app/release-metadata.json",
    );
  });

  it("redirects CLI release files to the public artifact base URL", () => {
    expect(
      resolveCliReleaseRedirectUrl({
        pathname: "/everr-app/everr",
        publicBaseUrl,
      }),
    ).toBe("https://cli-release.example.com/releases/everr-app/everr");

    expect(
      resolveCliReleaseRedirectUrl({
        pathname: "/everr-app/everr.sha256",
        publicBaseUrl,
      }),
    ).toBe(
      "https://cli-release.example.com/releases/everr-app/everr.sha256",
    );
  });

  it("redirects Linux CLI release files to the public artifact base URL", () => {
    expect(
      resolveCliReleaseRedirectUrl({
        pathname: "/everr-app/everr-linux-arm64",
        publicBaseUrl,
      }),
    ).toBe(
      "https://cli-release.example.com/releases/everr-app/everr-linux-arm64",
    );

    expect(
      resolveCliReleaseRedirectUrl({
        pathname: "/everr-app/everr-linux-x86_64",
        publicBaseUrl,
      }),
    ).toBe(
      "https://cli-release.example.com/releases/everr-app/everr-linux-x86_64",
    );

    expect(
      resolveCliReleaseRedirectUrl({
        pathname: "/everr-app/everr-linux-x86_64.sha256",
        publicBaseUrl,
      }),
    ).toBe(
      "https://cli-release.example.com/releases/everr-app/everr-linux-x86_64.sha256",
    );
  });

  it("rejects unknown CLI release files", () => {
    expect(
      resolveCliReleaseRedirectUrl({
        pathname: "/everr-app/debug.txt",
        publicBaseUrl,
      }),
    ).toBeNull();
  });

  it("rejects path traversal attempts", () => {
    expect(
      resolveCliReleaseRedirectUrl({
        pathname: "/everr-app/%2E%2E/secret",
        publicBaseUrl,
      }),
    ).toBeNull();
  });

  it("rejects malformed encoded paths", () => {
    expect(
      resolveCliReleaseRedirectUrl({
        pathname: "/everr-app/%E0%A4%A",
        publicBaseUrl,
      }),
    ).toBeNull();
  });
});
