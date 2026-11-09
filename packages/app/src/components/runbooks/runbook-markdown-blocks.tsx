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
import { type ComponentPropsWithoutRef, createElement, type ReactNode } from "react";
import { CALLOUT_KINDS, type CalloutKind } from "./runbook-markdown-plugins";

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

/** The URL of this page scrolled to `id`, for sharing a section. */
function sectionUrl(id: string): string {
  return typeof window === "undefined"
    ? `#${id}`
    : `${window.location.origin}${window.location.pathname}${window.location.search}#${id}`;
}

/** A heading with a button, shown on hover, that copies a link to it. */
function RunbookHeading({
  as,
  id,
  children,
}: {
  as: HeadingTag;
  id: string | undefined;
  children: ReactNode;
}) {
  const { state, copy } = useCopyToClipboard(id ? sectionUrl(id) : "");
  const copied = state === "copied";
  return createElement(
    as,
    { id, className: "group/heading relative" },
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
}

function headingComponent(as: HeadingTag) {
  return function Heading({ id, children }: ComponentPropsWithoutRef<"h2">) {
    return (
      <RunbookHeading as={as} id={id}>
        {children}
      </RunbookHeading>
    );
  };
}

export const HEADING_COMPONENTS = {
  h1: headingComponent("h1"),
  h2: headingComponent("h2"),
  h3: headingComponent("h3"),
  h4: headingComponent("h4"),
  h5: headingComponent("h5"),
  h6: headingComponent("h6"),
};

const CALLOUTS: Record<CalloutKind, { title: string; icon: typeof Info }> = {
  note: { title: "Note", icon: Info },
  tip: { title: "Tip", icon: Lightbulb },
  important: { title: "Important", icon: MessageSquareWarning },
  warning: { title: "Warning", icon: TriangleAlert },
  caution: { title: "Caution", icon: OctagonAlert },
};

function isCalloutKind(value: unknown): value is CalloutKind {
  return CALLOUT_KINDS.some((kind) => kind === value);
}

/** A quote, or a callout when it opens with `[!NOTE]` and the like. */
export function RunbookBlockquote({
  node: _node,
  children,
  ...props
}: ComponentPropsWithoutRef<"blockquote"> & { node?: unknown; "data-callout"?: string }) {
  const kind = props["data-callout"];
  if (!isCalloutKind(kind)) return <blockquote>{children}</blockquote>;
  const { title, icon: Icon } = CALLOUTS[kind];
  return (
    <aside className="runbook-callout" data-callout={kind}>
      <p className="runbook-callout-title">
        <Icon className="size-4" aria-hidden />
        {title}
      </p>
      {children}
    </aside>
  );
}

/**
 * An image, loaded as it nears the screen. Click it to see it full size,
 * unless it sits in a link, which it then follows.
 */
export function RunbookImage({
  node: _node,
  alt,
  ...props
}: ComponentPropsWithoutRef<"img"> & { node?: unknown; "data-in-link"?: boolean }) {
  const { "data-in-link": inLink, ...imageProps } = props;
  const image = <img {...imageProps} alt={alt} loading="lazy" decoding="async" />;
  if (inLink) return image;
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className="runbook-image-zoom"
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
          {...imageProps}
          alt={alt}
          className="h-auto max-h-[calc(100vh-6rem)] w-full rounded-md object-contain"
        />
      </DialogContent>
    </Dialog>
  );
}
