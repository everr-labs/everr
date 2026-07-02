import {
  Banner,
  BannerActions,
  BannerContent,
} from "@everr/ui/components/banner";
import { Button } from "@everr/ui/components/button";
import { useNavigate } from "@tanstack/react-router";
import { GitBranch, X } from "lucide-react";
import type * as React from "react";
import type { PreviewStatus } from "@/data/previews/overlay";

// One Banner tone per status, echoing the diff badges: amber ("warning") = "not
// live", emerald ("success") = new under the preview, red ("danger") = gone
// under it. Unchanged stays neutral — the resource is identical, the banner is
// only reminding you of the active context.
const TONE = {
  unchanged: "neutral",
  added: "success",
  changed: "warning",
  removed: "danger",
} as const satisfies Record<
  PreviewStatus,
  React.ComponentProps<typeof Banner>["tone"]
>;

// No per-resource status (the list pages, or a detail whose repoid the preview
// doesn't cover): fall back to the amber "not live" hue the header indicator
// wears, so the whole app speaks one preview color.
const GENERIC_TONE = "warning";

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

  // Sticky within whichever ancestor scrolls — on every page that mounts this,
  // that's the single `overflow-auto` content column in the `_dashboard`
  // layout, so the banner pins under the header while the list/detail scrolls
  // beneath it. The opaque `bg-background` (the Banner's own tint is
  // translucent) hides that content as it slides under, and `pb-3` gives a
  // clean opaque buffer below the pinned band. `z-20` sits above page content
  // and dragged dashboard panels but below popovers/modals.
  return (
    <div className="sticky top-0 z-20 bg-background pb-3">
      <Banner tone={status ? TONE[status] : GENERIC_TONE}>
        <GitBranch className="size-4 shrink-0" />
        <BannerContent>{message(name, status)}</BannerContent>
        <BannerActions className="-mr-1">
          <Button type="button" variant="ghost" size="sm" onClick={exitPreview}>
            <X data-icon="inline-start" />
            Exit preview
          </Button>
        </BannerActions>
      </Banner>
    </div>
  );
}
