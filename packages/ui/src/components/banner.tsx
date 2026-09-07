import { cn } from "@everr/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

const bannerVariants = cva("flex items-center gap-2 text-sm", {
  variants: {
    variant: {
      neutral: "text-muted-foreground",
      info: "bg-sky-500 text-foreground",
      success: "bg-emerald-500 text-emerald-300",
      warning: "bg-amber-500 text-amber-300",
      danger: "bg-red-500 text-red-300",
    },
  },
  defaultVariants: { variant: "neutral" },
});

// The outline sits on an overlay pseudo-element, not on the frame itself: an
// inset ring is a box-shadow, and CSS paints box-shadows below the element's
// descendants, so any content scrolling inside the frame covers it.
const bannerFrameVariants = cva(
  "relative flex min-h-0 flex-1 flex-col after:pointer-events-none after:absolute after:inset-0 after:z-20 after:ring-2 after:ring-inset",
  {
    variants: {
      variant: {
        neutral: "after:ring-border",
        info: "after:ring-sky-500",
        success: "after:ring-emerald-500",
        warning: "after:ring-amber-500",
        danger: "after:ring-red-500",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

function Banner({
  className,
  variant,
  role = "status",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof bannerVariants>) {
  return (
    <div
      data-slot="banner"
      role={role}
      className={cn(bannerVariants({ variant, className }))}
      {...props}
    />
  );
}

function BannerContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="banner-content"
      className={cn("min-w-0 flex-1", className)}
      {...props}
    />
  );
}

function BannerActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="banner-actions"
      className={cn("flex shrink-0 items-center gap-1", className)}
      {...props}
    />
  );
}

export {
  Banner,
  BannerActions,
  BannerContent,
  bannerFrameVariants,
  bannerVariants,
};
