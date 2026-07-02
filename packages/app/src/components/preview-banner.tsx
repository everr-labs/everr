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

  // A centered floating pill (think Vercel/Next.js preview mode). The wrapper is
  // a zero-height, sticky, full-width lane centered on the padded content column
  // (not the viewport — it lives inside the `_dashboard` scroll box, so it
  // already clears the sidebar). `top-3` matches the column's own `p-3` inset so
  // the chip holds a constant gap under the header whether the page is at rest or
  // scrolled — no jump as sticky engages. `h-0` + `-mb-3` cancel the flex `gap-3`
  // this element would otherwise add, so the pill overlays the content instead of
  // pushing it down; `items-start` stops the h-0 lane from stretch-squashing the
  // pill to zero height. `pointer-events-none` on the empty lane lets clicks fall
  // through to the content it floats over; the pill re-enables its own. `z-30`
  // clears sticky table headers and dragged panels (z-10/z-20) but stays under
  // popovers/modals (z-50). The Banner's `pill` shape brings the opaque, blurred,
  // elevated surface that keeps it legible over whatever scrolls beneath.
  return (
    <div className="pointer-events-none sticky top-3 z-30 -mb-3 flex h-0 items-start justify-center">
      <Banner
        shape="pill"
        tone={status ? STATUS_TONE[status] : GENERIC_TONE}
        // The 48rem cap only bites on very long preview names/copy; `100%` is
        // what keeps the pill inside the column on narrow viewports.
        className="pointer-events-auto max-w-[min(100%,48rem)] pl-3.5 pr-1.5"
      >
        <GitBranch className="size-4 shrink-0" />
        {/* Hug the text and truncate it (drop the primitive's `flex-1` grow) so a
            long preview name shortens the pill instead of colliding with the
            content underneath. */}
        <BannerContent className="flex-initial truncate">
          {message(name, status)}
        </BannerContent>
        <BannerActions>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-full px-2"
            onClick={exitPreview}
          >
            <X data-icon="inline-start" />
            Exit preview
          </Button>
        </BannerActions>
      </Banner>
    </div>
  );
}
