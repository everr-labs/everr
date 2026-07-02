import { GitBranch } from "lucide-react";
import type { PreviewStatus } from "@/data/previews/overlay";

// One tint per status, echoing the diff badges: amber = "not live", emerald =
// new under the preview, red = gone under it. Unchanged stays neutral — the
// resource is identical, the banner is only reminding you of the active context.
const TONE: Record<PreviewStatus, string> = {
  unchanged: "border-border bg-muted/40 text-muted-foreground",
  added: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  changed: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  removed: "border-red-500/30 bg-red-500/10 text-red-300",
};

function message(preview: string, status: PreviewStatus): string {
  switch (status) {
    case "removed":
      // The live document is what's actually on screen — say so plainly rather
      // than 404-ing mid-review.
      return `Removed in preview "${preview}". You're viewing the live version.`;
    case "added":
      return `New in preview "${preview}" — not yet live.`;
    case "changed":
      return `Changed in preview "${preview}" — this differs from live.`;
    case "unchanged":
      return `Viewing preview "${preview}". This resource is unchanged from live.`;
  }
}

/**
 * Context banner shown above a dashboard or runbook when a preview is active.
 * Names the preview and how this resource differs under it. Renders nothing on
 * Live (no status), so detail routes can mount it unconditionally.
 */
export function PreviewBanner({
  preview,
  status,
}: {
  preview?: string;
  status?: PreviewStatus;
}) {
  if (!preview || !status) return null;
  return (
    <div
      role="status"
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${TONE[status]}`}
    >
      <GitBranch className="size-4 shrink-0" />
      <span>{message(preview, status)}</span>
    </div>
  );
}
