import { cn } from "@everr/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

const bannerVariants = cva("flex items-center gap-2 text-sm", {
  variants: {
    variant: {
      neutral: "text-muted-foreground",
      info: "bg-info text-ctp-crust",
      success: "bg-success text-ctp-crust",
      warning: "bg-warning text-ctp-crust",
      danger: "bg-destructive text-ctp-crust",
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
        info: "after:ring-info",
        success: "after:ring-success",
        warning: "after:ring-warning",
        danger: "after:ring-destructive",
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
  return <div data-slot="banner-content" className={cn("min-w-0 flex-1", className)} {...props} />;
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

export { Banner, BannerActions, BannerContent, bannerFrameVariants, bannerVariants };
