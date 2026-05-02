const DEFAULT_DESKTOP_RELEASE_PUBLIC_BASE_URL =
  "https://everr-dev-desktop-release-artifacts.s3.eu-central-1.amazonaws.com";

export const allowedDesktopReleasePaths = new Set([
  "everr",
  "everr.sha256",
  "latest.json",
  "everr-macos-arm64.dmg",
  "everr-macos-arm64.app.tar.gz",
  "everr-macos-arm64.app.tar.gz.sig",
  "SHA256SUMS",
  "release-metadata.json",
]);

export function resolveDesktopReleaseRedirectUrl({
  pathname,
  publicBaseUrl = process.env.DESKTOP_RELEASE_PUBLIC_BASE_URL ??
    DEFAULT_DESKTOP_RELEASE_PUBLIC_BASE_URL,
}: {
  pathname: string;
  publicBaseUrl?: string;
}) {
  const prefix = "/everr-app/";

  if (!pathname.startsWith(prefix)) {
    return null;
  }

  let artifactPath: string;
  try {
    artifactPath = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }

  if (!allowedDesktopReleasePaths.has(artifactPath)) {
    return null;
  }

  return `${publicBaseUrl.replace(/\/+$/, "")}/everr-app/${artifactPath}`;
}
