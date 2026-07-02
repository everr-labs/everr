import { cn } from "@everr/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

// Contextual, page-level messaging surface (an active preview, a degraded
// environment, a pending migration) in two presentations. Tones are generic and
// domain-agnostic: the consumer maps its own semantics onto them.
//
//   shape="bar"  — a square, edge-to-edge announcement band: no rounding, no
//     outer inset, a tone-tinted bottom divider separating it from the content
//     below. Purposefully translucent so it blends over an opaque surface; a
//     caller that makes it sticky owns the opaque backdrop that hides scrolled
//     content behind it.
//   shape="pill" — a compact, rounded-full chip that FLOATS over content rather
//     than reserving a row: an opaque, blurred, elevated surface (the caller
//     pins/positions it) so it stays legible over whatever it overlaps, with the
//     tone carried by a colored border and the text/icon color.
const bannerVariants = cva("flex items-center gap-2 text-sm", {
  variants: {
    tone: {
      neutral: "text-muted-foreground",
      info: "text-sky-300",
      success: "text-emerald-300",
      warning: "text-amber-300",
      danger: "text-red-300",
    },
    shape: {
      bar: "border-b px-3 py-2",
      pill:
        "rounded-full border px-3.5 py-1.5 shadow-lg shadow-black/20 " +
        "bg-background/80 backdrop-blur-md",
    },
  },
  compoundVariants: [
    // bar: a translucent tone tint plus a tone-tinted border, meant to blend
    // over the opaque backdrop the caller provides.
    { shape: "bar", tone: "neutral", class: "border-border bg-muted/40" },
    { shape: "bar", tone: "info", class: "border-sky-500/30 bg-sky-500/10" },
    {
      shape: "bar",
      tone: "success",
      class: "border-emerald-500/30 bg-emerald-500/10",
    },
    {
      shape: "bar",
      tone: "warning",
      class: "border-amber-500/30 bg-amber-500/10",
    },
    { shape: "bar", tone: "danger", class: "border-red-500/30 bg-red-500/10" },
    // pill: tone rides on the border alone; the surface stays the neutral glass
    // so the chip is readable over any content it floats above.
    { shape: "pill", tone: "neutral", class: "border-border" },
    { shape: "pill", tone: "info", class: "border-sky-500/40" },
    { shape: "pill", tone: "success", class: "border-emerald-500/40" },
    { shape: "pill", tone: "warning", class: "border-amber-500/40" },
    { shape: "pill", tone: "danger", class: "border-red-500/40" },
  ],
  defaultVariants: {
    tone: "neutral",
    shape: "bar",
  },
});

function Banner({
  className,
  tone,
  shape,
  role = "status",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof bannerVariants>) {
  return (
    <div
      data-slot="banner"
      role={role}
      className={cn(bannerVariants({ tone, shape, className }))}
      {...props}
    />
  );
}

// The message. Takes the free space and clamps its own overflow so a long body
// never shoves the action slot off the row. In a pill a caller can drop the
// grow (`flex-initial`) so the chip hugs its text instead of spanning its cap.
function BannerContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="banner-content"
      className={cn("min-w-0 flex-1", className)}
      {...props}
    />
  );
}

// Trailing action slot (dismiss, undo, a link). Stays put; never shrinks.
function BannerActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="banner-actions"
      className={cn("flex shrink-0 items-center gap-1", className)}
      {...props}
    />
  );
}

export { Banner, BannerActions, BannerContent, bannerVariants };
