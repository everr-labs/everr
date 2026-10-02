const DEFAULT_CLI_RELEASE_PUBLIC_BASE_URL =
  "https://everr-dev-desktop-release-artifacts.s3.eu-central-1.amazonaws.com";

const allowedCliReleasePaths = new Set([
  "everr",
  "everr.sha256",
  "everr-linux-arm64",
  "everr-linux-arm64.sha256",
  "everr-linux-x86_64",
  "everr-linux-x86_64.sha256",
  "SHA256SUMS",
  "release-metadata.json",
]);

export function resolveCliReleaseRedirectUrl({
  pathname,
  publicBaseUrl = process.env.DESKTOP_RELEASE_PUBLIC_BASE_URL ??
    DEFAULT_CLI_RELEASE_PUBLIC_BASE_URL,
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

  if (!allowedCliReleasePaths.has(artifactPath)) {
    return null;
  }

  return `${publicBaseUrl.replace(/\/+$/, "")}/everr-app/${artifactPath}`;
}
