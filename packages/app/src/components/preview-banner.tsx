import {
  Banner,
  BannerActions,
  BannerContent,
} from "@everr/ui/components/banner";
import { Button } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { GitBranch, LogOut, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type * as React from "react";
import type { PreviewStatus } from "@/data/previews/overlay";
import { SIDEBAR_TRACKED_LEFT } from "@/lib/sidebar-tracked-left";
import {
  dismissPreview,
  hasEntrancePlayed,
  markEntrancePlayed,
  useIsPreviewDismissed,
} from "./preview-dismissals";

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

export function PreviewBanner({
  preview,
  status,
}: {
  preview: string | undefined;
  status?: PreviewStatus;
}) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  // Reads treat absent / "" / whitespace as live; mirror that so mounting on
  // live or with a stray `?preview=` doesn't render an empty banner.
  const name = (preview ?? "").trim();
  // Hooks run before any early return; dismissal is derived from the store, not
  // synced into local state.
  const dismissed = useIsPreviewDismissed(name);

  // Exit (clearing the param) short-circuits here on the next render: the whole
  // subtree — AnimatePresence included — unmounts at once, so there's no exit
  // animation to double up with the route transition. The Dismiss path keeps
  // `name` truthy and instead drops the pill out of AnimatePresence's children,
  // which is what plays the animated exit.
  if (!name) return null;

  const exitPreview = () =>
    navigate({ to: ".", search: (prev) => ({ ...prev, preview: undefined }) });

  const enter = reduceMotion ? { opacity: 1 } : { y: 0, opacity: 1 };
  const hidden = reduceMotion ? { opacity: 0 } : { y: -16, opacity: 0 };

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          className={cn(
            "pointer-events-none fixed top-13 right-0 z-30 flex h-0 items-start justify-center px-3",
            SIDEBAR_TRACKED_LEFT,
          )}
          // Every page mounts its own banner, but the pill should read as one
          // persistent element: the entrance only plays the first time this
          // preview appears (per reload); later mounts start already in place.
          initial={reduceMotion || hasEntrancePlayed(name) ? false : hidden}
          animate={enter}
          exit={{
            ...hidden,
            transition: {
              duration: reduceMotion ? 0 : 0.16,
            },
          }}
          transition={{
            duration: reduceMotion ? 0 : 0.22,
          }}
          onAnimationComplete={() => markEntrancePlayed(name)}
        >
          <Banner
            shape="pill"
            tone={status ? STATUS_TONE[status] : GENERIC_TONE}
            // The 48rem cap only bites on very long preview names/copy; `100%` is
            // what keeps the pill inside the column on narrow viewports.
            className="pointer-events-auto max-w-[min(100%,48rem)] py-1 pl-3.5 pr-1.5"
          >
            <GitBranch className="size-4 shrink-0" />
            {/* Hug the text and truncate it (drop the primitive's `flex-1` grow)
                so a long preview name shortens the pill instead of colliding with
                the content underneath. */}
            <BannerContent className="flex-initial truncate">
              {message(name, status)}
            </BannerContent>
            <BannerActions className="gap-0.5">
              {/* Exit is the labeled, primary affordance — a distinct `LogOut`
                  glyph (not an ×) so it never reads as a plain close. */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 rounded-full px-2"
                onClick={exitPreview}
              >
                <LogOut data-icon="inline-start" />
                Exit preview
              </Button>
              {/* A hairline splits the two actions so the bare × can't be
                  mistaken for part of the Exit button. */}
              <span
                aria-hidden
                className="mx-0.5 h-4 w-px shrink-0 bg-current opacity-20"
              />
              {/* Dismiss: icon-only, muted, conventional close. Hides the pill in
                  place without leaving preview mode. */}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Dismiss"
                title="Dismiss"
                className="rounded-full opacity-70 hover:opacity-100"
                onClick={() => dismissPreview(name)}
              >
                <X />
              </Button>
            </BannerActions>
          </Banner>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
