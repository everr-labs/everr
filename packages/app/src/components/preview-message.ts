import type { PreviewStatus } from "@/data/previews/overlay";

export function previewMessage(preview: string, status?: PreviewStatus): string {
  switch (status) {
    case "removed":
      return `Removed in preview "${preview}". You're viewing the live version.`;
    case "added":
      return `New in preview "${preview}" — not yet live.`;
    case "changed":
      return `Changed in preview "${preview}" — this differs from live.`;
    case "conflict":
      return `Conflict in preview "${preview}" — its name is already owned by another repo, so applying it live needs --adopt.`;
    case "unchanged":
      return `Viewing preview "${preview}". This resource is unchanged from live.`;
    default:
      return `Previewing "${preview}" — applied resources are overlaid on live.`;
  }
}
