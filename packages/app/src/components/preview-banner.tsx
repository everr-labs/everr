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

// Map each preview status onto one of the Banner primitive's generic tones —
// the primitive knows nothing about previews; this consumer attributes the
// meaning. Echoes the diff badges: emerald ("success") = new under the preview,
// amber ("warning") = differs from live, red ("danger") = gone under it. An
// unchanged resource carries no change, so it reads as info ("sky") — a calm
// "you're in a preview" reminder, not a change signal.
const STATUS_TONE = {
  unchanged: "info",
  added: "success",
  changed: "warning",
  removed: "danger",
} as const satisfies Record<
  PreviewStatus,
  React.ComponentProps<typeof Banner>["tone"]
>;

// No per-resource status (the list pages, or a detail whose repoid the preview
// doesn't cover): the banner is a neutral context reminder, not a diff, so it
// wears the same info ("sky") tone as an unchanged resource.
const GENERIC_TONE = "info" as const;

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

  // A full-bleed announcement bar. In the `_dashboard` layout the scroll box has
  // no padding of its own — the `p-3` lives on an inner wrapper — so the negative
  // `-mx-3`/`-mt-3` cancel that inset and the band reaches the scroll box's own
  // edges: edge-to-edge horizontally and flush against its top under the header.
  // Sticky relative to that scroll box (no transform in the chain), so it pins
  // while the list/detail scrolls beneath it. The opaque `bg-background` (the
  // Banner's own tint is translucent) hides content as it slides under; the
  // Banner's own bottom divider is the seam. `z-20` sits above page content and
  // dragged dashboard panels but below popovers/modals.
  return (
    <div className="sticky top-0 z-20 -mx-3 -mt-3 bg-background">
      <Banner tone={status ? STATUS_TONE[status] : GENERIC_TONE}>
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
