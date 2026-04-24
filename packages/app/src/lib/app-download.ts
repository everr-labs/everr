import { useEffect, useState } from "react";

const DOCS_ORIGIN = import.meta.env.DEV
  ? "http://localhost:3000"
  : "https://everr.dev";
const LATEST_MANIFEST_URL = `${DOCS_ORIGIN}/everr-app/latest.json`;

export const PLATFORMS = [
  {
    label: "macOS (Apple Silicon)",
    os: "macos",
    arch: "arm64",
    updaterTarget: "darwin-aarch64",
  },
] as const;

type LatestManifest = {
  platforms: Record<string, { url: string }>;
};

async function fetchLatestManifest(): Promise<LatestManifest> {
  const response = await fetch(LATEST_MANIFEST_URL, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${LATEST_MANIFEST_URL}: ${response.status}`,
    );
  }
  return (await response.json()) as LatestManifest;
}

export function useDownloadUrl(updaterTarget: string) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLatestManifest()
      .then((manifest) => {
        if (cancelled) return;
        const platformUrl = manifest.platforms[updaterTarget]?.url;
        if (platformUrl) {
          // latest.json archive URL points at the updater .app.tar.gz — swap
          // for the matching .dmg which sits alongside in the same release.
          setUrl(platformUrl.replace(/\.app\.tar\.gz$/, ".dmg"));
        }
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [updaterTarget]);

  return url;
}
