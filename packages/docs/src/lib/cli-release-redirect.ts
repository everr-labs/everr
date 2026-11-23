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

// Each release is also published under its version, so Homebrew formulas can
// pin a URL whose checksum never changes.
const versionedPathPrefix = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\//;

function isCliReleasePath(artifactPath: string) {
  const versioned = versionedPathPrefix.exec(artifactPath);
  const name = versioned ? artifactPath.slice(versioned[0].length) : artifactPath;
  return allowedCliReleasePaths.has(name);
}

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

  if (!isCliReleasePath(artifactPath)) {
    return null;
  }

  return `${publicBaseUrl.replace(/\/+$/, "")}/everr-app/${artifactPath}`;
}
