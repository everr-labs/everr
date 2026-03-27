const DOCS_ORIGIN = import.meta.env.DEV
  ? "http://localhost:3000"
  : "https://everr.dev";
const APP_DOWNLOAD_BASE = `${DOCS_ORIGIN}/everr-app`;

export const PLATFORMS = [
  {
    label: "macOS (Apple Silicon)",
    os: "macos",
    arch: "arm64",
  },
] as const;

export function getDownloadUrl(os: string, arch: string) {
  return `${APP_DOWNLOAD_BASE}/everr-app-${os}-${arch}.dmg`;
}
