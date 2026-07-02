import {
  Banner,
  BannerActions,
  BannerContent,
} from "@everr/ui/components/banner";
import { Button } from "@everr/ui/components/button";
import { useNavigate } from "@tanstack/react-router";
import { GitBranch, LogOut, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type * as React from "react";
import type { PreviewStatus } from "@/data/previews/overlay";
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

/**
 * Context banner for an active preview. Names the preview and — on detail routes
 * that pass a `status` — how this resource differs under it; lists pass no status
 * and get generic copy. It carries two affordances:
 *
 *   - "Exit preview" clears the `preview` search param (preserving all other
 *     params) to return to live — this unmounts the whole banner instantly (no
 *     exit animation, so it doesn't fight the route transition).
 *   - a Dismiss (×) button hides the pill in place without leaving preview mode;
 *     the header PreviewIndicator still signals the preview. Dismissal is
 *     in-memory only (see ./preview-dismissals), keyed by preview name, and
 *     animates the pill up and out.
 *
 * The pill animates in from the top on first appearance (page load / entering a
 * preview). Renders nothing on live, so callers can mount it unconditionally.
 */
export function PreviewBanner({
  preview,
  status,
}: {
  preview?: string;
  status?: PreviewStatus;
}) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  // Reads treat "" / whitespace as live; mirror that so a stray `?preview=`
  // doesn't render an empty banner.
  const name = preview?.trim();
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

  // Snappy, decisive vertical slide (ease-out-expo). Enter ~220ms, exit a hair
  // quicker at ~160ms per motion convention. `prefers-reduced-motion` collapses
  // both to an instant show/hide (no offset, zero duration).
  const enter = reduceMotion ? { opacity: 1 } : { y: 0, opacity: 1 };
  const hidden = reduceMotion ? { opacity: 0 } : { y: -16, opacity: 0 };

  return (
    // A centered floating pill (think Vercel/Next.js preview mode). The wrapper
    // is a zero-height, sticky, full-width lane centered on the padded content
    // column (not the viewport — it lives inside the `_dashboard` scroll box, so
    // it already clears the sidebar). `-mt-2` pulls the lane 8px into the
    // column's `p-3` inset and `top-1` pins at that same 4px offset, so the chip
    // holds a constant, tight gap under the header whether the page is at rest
    // or scrolled — no jump as sticky engages. `h-0` + margins summing to -12px
    // (`-mt-2` + `-mb-1`) cancel the flex `gap-3` this element would otherwise
    // add, so the pill overlays the content instead of pushing it down;
    // `items-start` stops the h-0 lane from stretch-squashing the pill to zero
    // height. `pointer-events-none` on the empty lane lets clicks fall through to
    // the content it floats over (and keeps content interactive throughout the
    // exit animation); the pill re-enables its own. `z-30` clears sticky table
    // headers (z-10) and react-grid-layout dragged panels (raw z-index: 3) but
    // stays under popovers/modals (z-50). The animated element IS this lane, so
    // the pill rides its translate — and `role="status"` stays on the Banner
    // child, keeping the lane as the Banner's parentElement.
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          className="pointer-events-none sticky top-1 z-30 -mt-2 -mb-1 flex h-0 items-start justify-center"
          // Every page mounts its own banner, but the pill should read as one
          // persistent element: the entrance only plays the first time this
          // preview appears (per reload); later mounts start already in place.
          initial={reduceMotion || hasEntrancePlayed(name) ? false : hidden}
          animate={enter}
          // The exit carries its own transition: the top-level `transition`
          // only governs `animate`, so without this the dismissal would run at
          // the enter's 220ms instead of the quicker 160ms it's meant to have.
          exit={{
            ...hidden,
            transition: {
              duration: reduceMotion ? 0 : 0.16,
              ease: [0.16, 1, 0.3, 1],
            },
          }}
          transition={{
            duration: reduceMotion ? 0 : 0.22,
            ease: [0.16, 1, 0.3, 1],
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
