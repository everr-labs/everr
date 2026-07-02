import { Button } from "@everr/ui/components/button";
import { useNavigate } from "@tanstack/react-router";
import { GitBranch, X } from "lucide-react";
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

// No per-resource status (the list pages, or a detail whose repoid the preview
// doesn't cover): fall back to the amber "not live" hue the header indicator
// wears, so the whole app speaks one preview color.
const GENERIC_TONE = "border-amber-500/30 bg-amber-500/10 text-amber-300";

function message(preview: string, status?: PreviewStatus): string {
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
    default:
      // Generic list/overview copy: name the preview and say what it does,
      // without claiming anything about a specific resource.
      return `Previewing "${preview}" — applied resources are overlaid on live.`;
  }
}

/**
 * Context banner for an active preview. Names the preview and — on detail routes
 * that pass a `status` — how this resource differs under it; lists pass no status
 * and get generic copy. Either way it carries the single exit affordance: the
 * "Exit preview" button clears the `preview` search param (preserving all other
 * params) to return to live. Renders nothing on live, so callers can mount it
 * unconditionally.
 */
export function PreviewBanner({
  preview,
  status,
}: {
  preview?: string;
  status?: PreviewStatus;
}) {
  const navigate = useNavigate();
  // Reads treat "" / whitespace as live; mirror that so a stray `?preview=`
  // doesn't render an empty banner.
  const name = preview?.trim();
  if (!name) return null;

  const exitPreview = () =>
    navigate({ to: ".", search: (prev) => ({ ...prev, preview: undefined }) });

  return (
    <div
      role="status"
      className={`mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
        status ? TONE[status] : GENERIC_TONE
      }`}
    >
      <GitBranch className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{message(name, status)}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={exitPreview}
        className="-mr-1 shrink-0"
      >
        <X data-icon="inline-start" />
        Exit preview
      </Button>
    </div>
  );
}
