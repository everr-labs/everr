import { cn } from "@everr/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

// Full-bleed announcement band for contextual, page-level messages (active
// preview, a degraded environment, a pending migration). Square and edge-to-edge
// by design — no rounding, no outer inset — carrying only its own internal
// content padding and a tone-tinted bottom divider that separates it from the
// content below. Purposefully translucent so it blends over an opaque surface;
// when a caller makes it sticky, that caller is responsible for an opaque
// backdrop so scrolled content stays hidden behind it. Tones are generic and
// domain-agnostic: the consumer maps its own semantics onto them.
const bannerVariants = cva(
  "flex items-center gap-2 border-b px-3 py-2 text-sm",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted/40 text-muted-foreground",
        info: "border-sky-500/30 bg-sky-500/10 text-sky-300",
        success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
        warning: "border-amber-500/30 bg-amber-500/10 text-amber-300",
        danger: "border-red-500/30 bg-red-500/10 text-red-300",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

function Banner({
  className,
  tone,
  role = "status",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof bannerVariants>) {
  return (
    <div
      data-slot="banner"
      role={role}
      className={cn(bannerVariants({ tone, className }))}
      {...props}
    />
  );
}

// The message. Takes the free space and clamps its own overflow so a long body
// never shoves the action slot off the row.
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
