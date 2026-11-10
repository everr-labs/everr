import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@everr/ui/components/dialog";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { cn } from "@everr/ui/lib/utils";
import {
  Check,
  Info,
  Lightbulb,
  Link as LinkIcon,
  MessageSquareWarning,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import { type ComponentPropsWithoutRef, createContext, createElement, useContext } from "react";
import type { ExtraProps } from "react-markdown";
import { CALLOUT_KINDS, type CalloutKind } from "./runbook-markdown-plugins";

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

/** The URL of this page scrolled to `id`, for sharing a section. */
function sectionUrl(id: string): string {
  return typeof window === "undefined"
    ? `#${id}`
    : `${window.location.origin}${window.location.pathname}${window.location.search}#${id}`;
}

/** A heading with a button, shown on hover, that copies a link to it. */
function headingComponent(as: HeadingTag, className?: string) {
  return function Heading({ id, children }: ComponentPropsWithoutRef<"h2">) {
    const { state, copy } = useCopyToClipboard(id ? sectionUrl(id) : "");
    const copied = state === "copied";
    return createElement(
      as,
      { id, className: cn("group/heading relative scroll-mt-4", className) },
      children,
      id && (
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Link copied" : "Copy link to this section"}
          className={cn(
            "ml-2 inline-flex size-6 translate-y-[-0.1em] items-center justify-center rounded-md align-middle text-muted-foreground transition-all hover:bg-muted hover:text-foreground focus-visible:opacity-100",
            copied ? "opacity-100" : "opacity-0 group-hover/heading:opacity-100",
          )}
        >
          {copied ? <Check className="size-3.5 text-primary" /> : <LinkIcon className="size-3.5" />}
        </button>
      ),
    );
  };
}

export const HEADING_COMPONENTS = {
  // A body `#` sits a step below the page title.
  h1: headingComponent("h1", "text-[1.875em]"),
  h2: headingComponent("h2"),
  h3: headingComponent("h3"),
  h4: headingComponent("h4"),
  // The deepest levels stay distinct from body text.
  h5: headingComponent("h5", "text-[0.875em] tracking-[0.04em] text-muted-foreground uppercase"),
  h6: headingComponent("h6", "text-[0.875em] tracking-[0.04em] text-muted-foreground uppercase"),
};

// Each kind's accent, which the callout's border, tint and title take.
const CALLOUTS: Record<CalloutKind, { title: string; icon: typeof Info; accent: string }> = {
  note: { title: "Note", icon: Info, accent: "[--callout:oklch(0.72_0.12_240)]" },
  tip: { title: "Tip", icon: Lightbulb, accent: "[--callout:oklch(0.75_0.14_150)]" },
  important: {
    title: "Important",
    icon: MessageSquareWarning,
    accent: "[--callout:oklch(0.72_0.14_300)]",
  },
  warning: { title: "Warning", icon: TriangleAlert, accent: "[--callout:oklch(0.8_0.14_75)]" },
  caution: { title: "Caution", icon: OctagonAlert, accent: "[--callout:oklch(0.68_0.19_25)]" },
};

function isCalloutKind(value: unknown): value is CalloutKind {
  return CALLOUT_KINDS.some((kind) => kind === value);
}

/** A quote, or a callout when it opens with `[!NOTE]` and the like. */
export function RunbookBlockquote({
  children,
  "data-callout": kind,
}: ComponentPropsWithoutRef<"blockquote"> & { "data-callout"?: string }) {
  if (!isCalloutKind(kind)) return <blockquote>{children}</blockquote>;
  const { title, icon: Icon, accent } = CALLOUTS[kind];
  return (
    <aside
      data-callout={kind}
      className={cn(
        "my-6 rounded-md border border-l-3 border-(--callout)/35 bg-(--callout)/7 px-4 py-3 [&>*]:mt-2 [&>*]:mb-0",
        accent,
      )}
    >
      <p className="mt-0! flex items-center gap-2 font-semibold text-(--callout)">
        <Icon className="size-4" aria-hidden />
        {title}
      </p>
      {children}
    </aside>
  );
}

/** True inside a link, whose images follow it rather than open full size. */
export const InLinkContext = createContext(false);

/**
 * An image, loaded as it nears the screen. Click it to see it full size,
 * unless it sits in a link, which it then follows.
 */
export function RunbookImage({
  node: _node,
  alt,
  ...props
}: ComponentPropsWithoutRef<"img"> & ExtraProps) {
  const image = (
    <img
      {...props}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="my-0! inline-block max-h-80 w-auto rounded-md"
    />
  );
  if (useContext(InLinkContext)) return image;
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            // Full width: a button shrinks to its content, and an SVG without
            // its own size then shrinks to nothing.
            className="block w-full cursor-zoom-in rounded-md text-start"
            aria-label={`View ${alt || "image"} full size`}
          />
        }
      >
        {image}
      </DialogTrigger>
      {/* A fixed width: an SVG without its own size would otherwise collapse to nothing. */}
      <DialogContent className="w-[min(64rem,calc(100vw-4rem))] max-w-none p-2 sm:max-w-none">
        <DialogTitle className="sr-only">{alt || "Image"}</DialogTitle>
        <img
          {...props}
          alt={alt}
          className="h-auto max-h-[calc(100vh-6rem)] w-full rounded-md object-contain"
        />
      </DialogContent>
    </Dialog>
  );
}
